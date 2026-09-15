#!/bin/bash
# electron-builder's own after-install.tpl, reproduced verbatim (this file *replaces*
# it entirely — electron-builder doesn't append custom `deb.afterInstall` scripts to
# its default one) — up to the final override block at the end.
if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# --- CLLG override: force the classic setuid-root sandbox unconditionally ---
#
# The upstream template instead does a quick `unshare --user true` check and only
# sets chrome-sandbox setuid-root when that check *fails*. On Ubuntu 23.10+/24.04+
# that check passes (unprivileged user namespaces exist in principle) even though
# kernel.apparmor_restrict_unprivileged_userns=1 blocks Chromium's own unprivileged
# namespace sandbox at runtime — so the upstream logic leaves chrome-sandbox
# non-setuid and the app can only launch with --no-sandbox. Forcing the classic
# setuid-root sandbox sidesteps that AppArmor restriction entirely (it doesn't need
# user namespaces) and works everywhere, matching what other major Electron apps do
# on these kernels.
SANDBOX='/opt/${sanitizedProductName}/chrome-sandbox'
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi
