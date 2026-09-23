"""Exercise release sequencing with fake Docker/curl; never contacts the host."""
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SHA = 'a' * 40
MOCK = r'''import os, sys
from pathlib import Path
args = sys.argv[1:]
name = Path(sys.argv[0]).name
with open(os.environ['CALLS'], 'a') as log:
    log.write(name + ' ' + ' '.join(args) + '\n')
failure = os.environ.get('FAILURE', '')
if name == 'docker':
    if args[0] == 'inspect':
        print('unhealthy' if failure == 'db' else 'healthy')
    elif args[0] == 'build':
        if failure == 'build': sys.exit(1)
    else:
        args = args[args.index('-f') + 2:]
        args = args[args.index('-f') + 2:]
        if args[:3] == ['ps', '-q', 'db']: print('existing-db')
        if 'pg_dump' in args:
            # Docker exec attaches stdin even when pg_dump doesn't need it.
            # With bash -s this used to consume the remaining deployment script.
            sys.stdin.read()
            if failure == 'backup': sys.exit(1)
            print('mock database dump')
        if 'pg_restore' in args:
            assert sys.stdin.read().strip() == 'mock database dump'
            print('mock table of contents')
        if args[0] == 'run' and failure == 'migration': sys.exit(1)
        if args[0] == 'up' and failure == 'startup': sys.exit(1)
elif name == 'curl':
    if any('/v1/overview' in a for a in args):
        print('200' if failure == 'auth' else '401', end='')
    elif any('/dev/overview-playground' in a for a in args): print('404', end='')
    elif any('/v1/readiness' in a for a in args): print('{"status":"ok"}')
'''


class ReleaseTests(unittest.TestCase):
    def test_local_dry_run_uses_commit_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', folder], check=True)
            subprocess.run(['git', '-C', folder, 'config', 'user.email', 'test@example.invalid'], check=True)
            subprocess.run(['git', '-C', folder, 'config', 'user.name', 'Release Test'], check=True)
            (root / 'deploy-staging.sh').write_text((ROOT / 'deploy-staging.sh').read_text())
            helper = root / 'deploy/private-staging/release-remote.sh'
            helper.parent.mkdir(parents=True)
            helper.write_text('#!/bin/bash\nexit 0\n')
            subprocess.run(['git', '-C', folder, 'add', '.'], check=True)
            subprocess.run(['git', '-C', folder, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], check=True)
            (root / 'uncommitted.txt').write_text('must stay local')
            result = subprocess.run(['bash', str(root / 'deploy-staging.sh'), '--dry-run', 'HEAD'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('no SSH connection', result.stdout)
            self.assertIn('will NOT be deployed', result.stdout)

    def test_local_rejects_option_as_revision(self):
        result = subprocess.run(['bash', str(ROOT / 'deploy-staging.sh'), '--dry-run', '--bad'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)

    def run_release(self, failure='', streamed=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base, state, bin_dir = root / 'base', root / 'state', root / 'bin'
            (base / 'secrets').mkdir(parents=True)
            state.mkdir()
            bin_dir.mkdir()
            for name in ['vault-key', 'staging-ca.crt']:
                (base / 'secrets' / name).write_text('original secret')
            for name in ['compose.yml', 'Caddyfile', 'init-db.sh']:
                (base / name).write_text('original configuration')
            (state / 'current').write_text('previous-release\n')
            for name in ['docker', 'curl', 'flock']:
                file = bin_dir / name
                file.write_text('#!' + sys.executable + '\n' + MOCK)
                file.chmod(0o700)
            runner = (ROOT / 'deploy/private-staging/release-remote.sh').read_text()
            runner = runner.replace('base=/opt/nraialgo-staging-f78936c/deploy/private-staging', 'base=' + str(base))
            runner = runner.replace('state=/opt/nraialgo-staging', 'state=' + str(state))
            script = root / 'runner.sh'
            script.write_text(runner)
            fd, archive = tempfile.mkstemp(prefix='nraialgo-release.', suffix='.tar', dir='/tmp')
            os.close(fd)
            try:
                with tarfile.open(archive, 'w') as tar:
                    for name in ['Dockerfile', 'package-lock.json']:
                        data = b'test source'
                        entry = tarfile.TarInfo(name)
                        entry.size = len(data)
                        tar.addfile(entry, io.BytesIO(data))
                env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'],
                       'CALLS': str(root / 'calls'), 'FAILURE': failure}
                command = ['bash', '-s', '--', archive, SHA] if streamed else ['bash', str(script), archive, SHA]
                result = subprocess.run(command, input=runner if streamed else '', env=env, capture_output=True, text=True, timeout=30)
                calls = (root / 'calls').read_text()
                current = (state / 'current').read_text()
                self.assertFalse(Path(archive).exists())
                self.assertEqual((base / 'secrets/vault-key').read_text(), 'original secret')
                self.assertNotIn(' down ', calls)
                self.assertNotIn('initialize-secrets', calls)
                if failure:
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(current, 'previous-release\n')
                else:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn(SHA, current)
                    self.assertTrue(list((state / 'backups').glob('*/database.dump')))
                    self.assertTrue(list((state / 'backups').glob('*/secrets-and-config.tgz')))
                return calls
            finally:
                Path(archive).unlink(missing_ok=True)

    def test_success_order_and_application_only_start(self):
        calls = self.run_release()
        self.assertLess(calls.index(' build '), calls.index(' stop api'))
        self.assertLess(calls.index(' stop api'), calls.index('pg_dump'))
        self.assertLess(calls.index('pg_dump'), calls.index(' run --rm --no-deps -T migrate'))
        self.assertLess(calls.index(' run --rm --no-deps -T migrate'), calls.index(' up '))
        self.assertIn('--no-deps --no-build --pull never --wait --wait-timeout 120 api web', calls)

    def test_build_failure_preserves_running_app(self):
        calls = self.run_release('build')
        self.assertNotIn(' stop api', calls)
        self.assertNotIn('pg_dump', calls)

    def test_backup_cannot_consume_streamed_script(self):
        calls = self.run_release(streamed=True)
        self.assertIn('pg_restore --list', calls)
        self.assertIn(' run --rm --no-deps -T migrate', calls)
        self.assertIn(' up ', calls)

    def test_database_unhealthy_aborts_before_build(self):
        calls = self.run_release('db')
        self.assertNotIn(' build ', calls)

    def test_backup_failure_never_migrates(self):
        calls = self.run_release('backup')
        self.assertNotIn(' run --rm', calls)

    def test_migration_failure_keeps_api_stopped(self):
        calls = self.run_release('migration')
        self.assertNotIn(' up ', calls)
        self.assertEqual(calls.count(' stop api'), 2)

    def test_startup_failure_keeps_api_stopped(self):
        calls = self.run_release('startup')
        self.assertEqual(calls.count(' stop api'), 2)

    def test_missing_auth_protection_rejects_release(self):
        calls = self.run_release('auth')
        self.assertEqual(calls.count(' stop api'), 2)


if __name__ == '__main__':
    unittest.main()
