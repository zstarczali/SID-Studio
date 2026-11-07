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
            self.assertEqual([c.args[0] for c in ftp.cwd.call_args_list], ['/', 'www', 'downloads', 'SIDS'])
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


if __name__ == '__main__':
    unittest.main()
