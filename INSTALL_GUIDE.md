# DiskPilot Installation Guide

## macOS

1. Drag **DiskPilot** into your **Applications** folder.
2. **First Launch (macOS Gatekeeper Note):**
   Since DiskPilot is free & open-source, it is currently not signed with a paid Apple Developer certificate. On first launch, macOS Gatekeeper may show a warning like *"DiskPilot is damaged and can’t be opened"* or block the application.

   You can easily resolve this one-time prompt using either method:

   - **Option 1: Terminal (Quickest)**
     Run this command in Terminal to clear the quarantine flag:
     ```bash
     xattr -cr /Applications/DiskPilot.app
     ```
   
   - **Option 2: System Settings (GUI)**
     1. Open **System Settings** → **Privacy & Security**.
     2. Scroll down to the **Security** section.
     3. You will see *"DiskPilot was blocked from use..."* — click **"Open Anyway"**.
     4. Confirm with your password/Touch ID and click **"Open"**.

   - **Option 3: Right-Click Open**
     1. In Finder, open the **Applications** folder.
     2. **Right-click** (or Control+click) **DiskPilot.app** → click **"Open"** → click **"Open"** again.

   *(This is a one-time step. DiskPilot will open normally on every subsequent launch.)*

## Windows

1. Extract the downloaded archive.
2. Run the `.exe` installer — DiskPilot will install and launch automatically.

## Linux

- **AppImage:** Make executable and run:
  ```bash
  chmod +x DiskPilot-*.AppImage && ./DiskPilot-*.AppImage
  ```
- **Debian / Ubuntu:** Install the `.deb` package:
  ```bash
  sudo dpkg -i diskpilot_*.deb
  ```
