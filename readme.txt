VA SID STUDIO 1.8.0 - INSTALLATION GUIDE
==================================

This guide covers installation on Windows, Linux and macOS.

Project: https://github.com/zstarczali/va-sid-editor

New in 1.8.0: the SID Editor's L (legato) effect and gate-off table steps,
a closer .sid import, and VA SID Core 1.3 with an 8580 digi boost setting
for loud $D418 samples. 1.7.2: the Channels view of the Spectrum analyzer follows the Bands
setting for MOD and other tracker modules too. 1.7.1: the main window no
longer flashes up empty at start, and the SID Player toolbar has separators
between its button groups. 1.7.0 brought
1-5 star ratings and duplicate removal in the SID Player playlist, opening
.sidpl playlists by double click, a download spinner on tunes, and a MOD
Player buffer setting. See CHANGELOG.md for release notes and
VA SID Studio Manual.md (or docs/VA SID Studio Manual.pdf) for full usage.
Upgrading keeps your saved settings and edited tune in application storage.

1. DOWNLOADING PREBUILT INSTALLERS
---------------------------------
Open the Actions tab on the project's GitHub page, then select a successful
run of the "Build installers" workflow. Download the package for your
system from the Artifacts section and extract the ZIP file.
You may need to sign in to GitHub to download workflow artifacts.
If the artifact has expired, download an available artifact from a newer successful run.

Build variants configured in the project workflow:

  Windows Intel/AMD 64-bit: va-sid-studio-windows-x64    (.exe, .msi)
  Windows ARM64:           va-sid-studio-windows-arm64  (.exe)
  Mac Apple Silicon:       va-sid-studio-macos-arm64    (.dmg)
  Mac Intel:               va-sid-studio-macos-x64      (.dmg)
  Linux Intel/AMD 64-bit:   va-sid-studio-linux-x64      (.deb, .rpm,
                                                       .AppImage)

You do not need Node.js, npm, Rust or Git to use a prebuilt application.

2. WINDOWS
----------
1. Download and extract the appropriate Windows package.
2. Run the .exe or .msi installer and follow its instructions.
3. Launch VA SID Studio from the Start menu.

The application uses Microsoft Edge WebView2 Runtime. If the installer or
application reports that it is missing, install the appropriate Evergreen
Runtime version:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

3. LINUX
--------
The project's Linux installers are built for x86_64 on Ubuntu 22.04.
Compatibility also depends on your distribution's system libraries.
WebKitGTK 4.1 and GTK 3 are required at runtime. Using your package manager
is recommended because it also handles package dependencies.

Debian / Ubuntu (.deb):
  Open a terminal in the directory containing the extracted .deb file:

    sudo apt update
    sudo apt install ./PACKAGE_NAME.deb

Fedora (.rpm):
  Open a terminal in the directory containing the extracted .rpm file:

    sudo dnf install ./PACKAGE_NAME.rpm

Replace PACKAGE_NAME with the actual downloaded filename in each command.
After installation, find VA SID Studio in your application menu.

AppImage:
  Run the following commands using the actual downloaded filename:

    chmod +x ./PACKAGE_NAME.AppImage
    ./PACKAGE_NAME.AppImage

If the AppImage fails to start because of a FUSE error, try:

    ./PACKAGE_NAME.AppImage --appimage-extract-and-run

The required system libraries must still be available.

4. macOS
--------
1. Download the arm64 package for Apple Silicon or x64 for an Intel Mac.
2. Extract the download and open the .dmg file.
3. Drag VA SID Studio into the Applications folder.
4. Launch the application from Applications.

The app is not signed with an Apple Developer ID and is not notarized (the
build workflow only signs it ad hoc). macOS therefore marks the downloaded
app as quarantined, and may say it "is damaged and can't be opened" or that
it "cannot be verified". If you downloaded the package from a trusted
source, remove the quarantine flag once, after copying the app to
Applications:

    xattr -cr "/Applications/VA SID Studio.app"

Then launch it again. Alternatively, open System Settings > Privacy &
Security and use "Open Anyway" for this application if that option is shown.

5. TROUBLESHOOTING
------------------
- Missing webkit2gtk-4.1 or OpenSSL on Linux:
  Install the required WebKitGTK 4.1 and OpenSSL runtime packages using
  your distribution's package manager. WebKitGTK 4.0 alone does not
  replace the 4.1 version used by this project.

- Blank window on Linux, with "Failed to create GBM buffer" in the terminal:
  Start the application like this:

    WEBKIT_DMABUF_RENDERER_DISABLE_GBM=1 ./PACKAGE_NAME.AppImage

  If the window stays blank, try this instead:

    WEBKIT_DISABLE_DMABUF_RENDERER=1 ./PACKAGE_NAME.AppImage

- No sound on Linux, with "GStreamer element ... not found" in the terminal:
  The player seems to run, but stays silent. Install these packages:

    sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-alsa gstreamer1.0-pulseaudio

  The .deb and .rpm packages ask for them, and the AppImage carries them.

- Opening www/index.html directly in a browser does not work fully:
  Use the installed application. Desktop features require its bundled
  Tauri/Rust backend.

- Preserving your music:
  The edited tune is retained in local application storage. Before
  reinstalling, uninstalling or clearing application data, use "Save .bin"
  to save any important work to a separate file.

Technical reference:
  Tauri 2 system dependencies: https://v2.tauri.app/start/prerequisites/

