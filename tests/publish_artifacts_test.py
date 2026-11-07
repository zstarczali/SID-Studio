import importlib.util
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('publish', Path(__file__).parents[1] / 'scripts/publish-artifacts.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def artifact(self, name):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'artifact')
        return path

    def test_collects_extracted_installers_and_manual_without_zip_wrappers(self):
        self.artifact('windows/nsis/studio.exe')
        self.artifact('mac/dmg/studio.dmg')
        self.artifact('linux/appimage/studio.AppImage')
        self.artifact('manual/' + publish.MANUAL)
        self.artifact('ignored.zip')
        self.assertEqual(set(publish.collect_files(self.root)), {'studio.exe', 'studio.dmg', 'studio.AppImage', publish.MANUAL})

    def test_rejects_missing_manual_before_connecting(self):
        self.artifact('studio.exe')
        with patch.object(publish.ftplib, 'FTP_TLS') as ftp:
            with self.assertRaisesRegex(ValueError, 'no SID manual'):
                publish.upload(self.root)
            ftp.assert_not_called()

    def test_rejects_duplicate_names(self):
        self.artifact('a/studio.exe')
        self.artifact('b/studio.exe')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            publish.collect_files(self.root)

    def test_uploads_to_requested_directory_with_tls_and_checks_sizes(self):
        self.artifact('studio.exe')
        self.artifact(publish.MANUAL)
        ftp = MagicMock()
        ftp.size.return_value = 8
        env = {'FTP_HOST': 'example.test', 'FTP_USERNAME': 'test', 'FTP_PASSWORD': 'test-only', 'FTP_DIRECTORY': '/www/downloads/SIDS/'}
        with patch.dict(os.environ, env), patch.object(publish.ftplib, 'FTP_TLS') as cls:
            cls.return_value.__enter__.return_value = ftp
            publish.upload(self.root)
            self.assertTrue(cls.call_args.kwargs['context'].check_hostname)
            ftp.connect.assert_called_once_with('example.test', 21)
            ftp.prot_p.assert_called_once()
            ftp.cwd.assert_called_once_with('/www/downloads/SIDS')
            self.assertEqual({c.args[0] for c in ftp.storbinary.call_args_list}, {'STOR studio.exe', 'STOR ' + publish.MANUAL})
            self.assertEqual(ftp.size.call_count, 2)
            ftp.delete.assert_not_called()

    def test_rejects_failed_or_unrelated_builds(self):
        response = MagicMock()
        with patch.dict(os.environ, {'BUILD_RUN_ID': '123', 'GH_REPOSITORY': 'owner/repo', 'GH_TOKEN': 'test-only'}), patch.object(publish.urllib.request, 'urlopen') as request:
            request.return_value.__enter__.return_value = response
            for run in [
                {'path': '.github/workflows/other.yml', 'status': 'completed', 'conclusion': 'success'},
                {'path': '.github/workflows/build-installers.yml', 'status': 'completed', 'conclusion': 'failure'},
            ]:
                with patch.object(publish.json, 'load', return_value=run), self.assertRaises(ValueError):
                    publish.validate_run()

    def test_old_build_uses_pdf_from_its_source_commit(self):
        self.artifact('studio.exe')
        manual = self.root.parent / (self.root.name + '-manual.pdf')
        manual.write_bytes(b'%PDF-1.7\nsource-build-manual')
        self.addCleanup(manual.unlink)
        with patch.dict(os.environ, {'SID_MANUAL_PATH': str(manual)}):
            files = publish.collect_files(self.root)
        self.assertEqual(files[publish.MANUAL], manual)
        self.assertIn('studio.exe', files)

    def test_artifact_manual_takes_precedence_over_fallback(self):
        self.artifact('studio.exe')
        manual = self.artifact('manual/' + publish.MANUAL)
        with patch.dict(os.environ, {'SID_MANUAL_PATH': '/missing/fallback.pdf'}):
            self.assertEqual(publish.collect_files(self.root)[publish.MANUAL], manual)

    def test_rejects_invalid_fallback_pdf(self):
        self.artifact('studio.exe')
        invalid = self.artifact('not-a-pdf.txt')
        with patch.dict(os.environ, {'SID_MANUAL_PATH': str(invalid)}):
            with self.assertRaisesRegex(ValueError, 'not a PDF'):
                publish.collect_files(self.root)

    def test_source_build_commit_is_passed_to_manual_checkout(self):
        output = self.root / 'github-output'
        run = {'path': '.github/workflows/build-installers.yml', 'status': 'completed', 'conclusion': 'success', 'head_sha': 'a' * 40}
        env = {'BUILD_RUN_ID': '123', 'GH_REPOSITORY': 'owner/repo', 'GH_TOKEN': 'test-only', 'GITHUB_OUTPUT': str(output)}
        with patch.dict(os.environ, env), patch.object(publish.urllib.request, 'urlopen'), patch.object(publish.json, 'load', return_value=run):
            publish.validate_run()
        self.assertEqual(output.read_text(), 'head_sha=' + 'a' * 40 + '\n')

    def test_login_failure_reports_stage_and_server_reply_without_password(self):
        self.artifact('studio.exe')
        self.artifact(publish.MANUAL)
        ftp = MagicMock()
        ftp.login.side_effect = publish.ftplib.error_perm('530 Login rejected test-password')
        env = {'FTP_HOST': 'example.test', 'FTP_USERNAME': 'test', 'FTP_PASSWORD': 'test-password', 'FTP_DIRECTORY': '/www/downloads/SIDS/'}
        with patch.dict(os.environ, env), patch.object(publish.ftplib, 'FTP_TLS') as cls:
            cls.return_value.__enter__.return_value = ftp
            with self.assertRaises(ValueError) as caught:
                publish.upload(self.root)
        self.assertIn('login', str(caught.exception))
        self.assertIn('530 Login rejected', str(caught.exception))
        self.assertNotIn('test-password', str(caught.exception))
        ftp.storbinary.assert_not_called()

    def test_upload_failure_reports_filename_and_server_reply(self):
        self.artifact('studio.exe')
        self.artifact(publish.MANUAL)
        ftp = MagicMock()
        ftp.storbinary.side_effect = publish.ftplib.error_perm('550 Permission denied')
        env = {'FTP_HOST': 'example.test', 'FTP_USERNAME': 'test', 'FTP_PASSWORD': 'test-password', 'FTP_DIRECTORY': '/www/downloads/SIDS/'}
        with patch.dict(os.environ, env), patch.object(publish.ftplib, 'FTP_TLS') as cls:
            cls.return_value.__enter__.return_value = ftp
            with self.assertRaisesRegex(ValueError, 'uploading .*550 Permission denied'):
                publish.upload(self.root)


if __name__ == '__main__':
    unittest.main()
