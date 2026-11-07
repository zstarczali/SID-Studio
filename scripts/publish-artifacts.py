"""Publish extracted build artifacts over explicit FTPS (TLS on port 21)."""
import ftplib
import json
import os
from pathlib import Path, PurePosixPath
import ssl
import sys
import urllib.request

INSTALLERS = {'.exe', '.msi', '.dmg', '.deb', '.rpm', '.appimage'}
MANUAL = 'VA SID Studio Manual.pdf'


def validate_run():
    run_id = os.environ['BUILD_RUN_ID']
    if not run_id.isascii() or not run_id.isdecimal():
        raise ValueError('Build run ID must be a positive integer.')
    repository = os.environ['GH_REPOSITORY']
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repository}/actions/runs/{run_id}',
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        run = json.load(response)
    if run.get('path', '').split('@')[0] != '.github/workflows/build-installers.yml':
        raise ValueError('The selected run is not a Build installers run.')
    if run.get('status') != 'completed' or run.get('conclusion') != 'success':
        raise ValueError('The selected build must have completed successfully.')
    sha = run['head_sha']
    if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
        raise ValueError('Invalid source build commit.')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'head_sha={sha}\n')
    print(f'Validated build {run_id}, commit {sha}.')


def collect_files(root):
    files = {}
    for path in sorted(Path(root).rglob('*')):
        if path.is_symlink():
            raise ValueError('Artifact symlinks are not supported.')
        if not path.is_file():
            continue
        if path.suffix.lower() not in INSTALLERS and path.name != MANUAL:
            continue
        if path.name in files:
            raise ValueError(f'Duplicate output filename: {path.name}')
        if '\r' in path.name or '\n' in path.name or path.stat().st_size == 0:
            raise ValueError('Invalid or empty artifact file.')
        files[path.name] = path
    if not any(path.suffix.lower() in INSTALLERS for path in files.values()):
        raise ValueError('No installers found in the downloaded artifacts.')
    if MANUAL not in files:
        fallback = os.environ.get('SID_MANUAL_PATH')
        if not fallback:
            raise ValueError('The build has no SID manual artifact and no source-commit PDF was provided.')
        manual = Path(fallback)
        if manual.is_symlink() or not manual.is_file():
            raise ValueError('The source build commit has no SID manual PDF.')
        with manual.open('rb') as source:
            if source.read(5) != b'%PDF-':
                raise ValueError('The source build manual is not a PDF.')
        files[MANUAL] = manual
        print('Using the SID manual PDF from the selected build commit.', flush=True)
    return files


def safe_error(error):
    message = str(error)
    for key in ('FTP_PASSWORD', 'GH_TOKEN'):
        secret = os.environ.get(key)
        if secret:
            message = message.replace(secret, '[REDACTED]')
    return ' '.join(message.splitlines())[:600]


def upload(root):
    files = collect_files(root)
    password = os.environ.get('FTP_PASSWORD', '')
    if not password:
        raise ValueError('Set the FTP_PASSWORD repository Actions secret before publishing.')
    directory = PurePosixPath(os.environ['FTP_DIRECTORY'])
    if not directory.is_absolute() or '..' in directory.parts:
        raise ValueError('FTP_DIRECTORY must be an absolute directory without parent traversal.')
    stage = 'opening FTPS connection'
    try:
        # Validate the server certificate and encrypt both login and data connections.
        with ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=120) as ftp:
            stage = 'connecting to server'
            ftp.connect(os.environ['FTP_HOST'], 21)
            stage = 'login (check the FTP_PASSWORD Actions secret if rejected)'
            ftp.login(os.environ['FTP_USERNAME'], password)
            stage = 'enabling encrypted data transfers'
            ftp.prot_p()
            ftp.set_pasv(True)
            stage = f'opening target directory {directory}'
            try:
                ftp.cwd(str(directory))
            except ftplib.error_perm as error:
                if not str(error).startswith('550'):
                    raise
                ftp.cwd('/')
                for part in directory.parts[1:]:
                    stage = f'opening directory component {part}'
                    try:
                        ftp.cwd(part)
                    except ftplib.error_perm as error:
                        if not str(error).startswith('550'):
                            raise
                        stage = f'creating directory component {part}'
                        ftp.mkd(part)
                        ftp.cwd(part)
            for name, path in files.items():
                stage = f'uploading {name}'
                print(f'Uploading {name} ({path.stat().st_size} bytes)', flush=True)
                with path.open('rb') as source:
                    ftp.storbinary('STOR ' + name, source, blocksize=256 * 1024)
                stage = f'verifying uploaded size of {name}'
                ftp.voidcmd('TYPE I')
                if ftp.size(name) != path.stat().st_size:
                    raise ValueError(f'Remote size verification failed: {name}')
    except (ftplib.Error, OSError, EOFError) as error:
        raise ValueError(f'FTP {stage}: {safe_error(error)}') from None
    print(f'Published {len(files)} files. Existing unrelated files were retained.')


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--validate-run']:
            validate_run()
        elif len(sys.argv) == 2:
            upload(sys.argv[1])
        else:
            raise ValueError('Usage: publish-artifacts.py ARTIFACT_DIRECTORY | --validate-run')
    except Exception as error:
        # FTP errors can contain server responses: never print login details.
        if isinstance(error, ValueError):
            print(f'Publish failed: {error}', file=sys.stderr)
        else:
            print(f'Publish failed ({type(error).__name__}). Check the connection and source build.', file=sys.stderr)
        sys.exit(1)
