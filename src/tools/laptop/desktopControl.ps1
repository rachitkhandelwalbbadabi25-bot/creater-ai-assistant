# ================================================================================
# src/tools/laptop/desktopControl.ps1 -- Windows Desktop Native CUA Input Helper
# Provides fast, native mouse movements, clicks, window focus, and keystrokes.
# ================================================================================

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '')]
param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    [int]$X = 0,
    [int]$Y = 0,
    [string]$Button = "left",
    [string]$Text = "",
    [string]$TextBase64 = "",
    [string]$Key = "",
    [string]$TargetWindow = "",
    [string]$SiteHint = "",
    [string]$FilePath = "",
    [string]$Approved = "",
    [string]$Overwrite = "",
    [string]$ExpectedTextBase64 = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not ("DesktopNative" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DesktopNative {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int dwProcessId);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", EntryPoint = "VkKeyScanExW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern short VkKeyScanExW(char ch, IntPtr dwhkl);

    [DllImport("user32.dll", EntryPoint = "MapVirtualKeyExW", ExactSpelling = true)]
    public static extern uint MapVirtualKeyExW(uint uCode, uint uMapType, IntPtr dwhkl);

    [DllImport("user32.dll")]
    public static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")]
    private static extern uint GetThreadIdForHkl(IntPtr hWnd, IntPtr processIdPtr);

    [DllImport("user32.dll")]
    public static extern short GetKeyState(int nVirtKey);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, KBD_INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBD_MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBD_KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBD_HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct KBD_INPUTUNION {
        [FieldOffset(0)] public KBD_MOUSEINPUT mi;
        [FieldOffset(0)] public KBD_KEYBDINPUT ki;
        [FieldOffset(0)] public KBD_HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBD_INPUT {
        public uint type;
        public KBD_INPUTUNION U;
    }

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const ushort VK_TAB = 0x09;
    public const ushort VK_RETURN = 0x0D;
    public const ushort VK_SHIFT = 0x10;
    public const ushort VK_CONTROL = 0x11;
    public const ushort VK_MENU = 0x12;
    public const ushort VK_CAPITAL = 0x14;
    public const ushort VK_ESCAPE = 0x1B;
    public const ushort VK_LWIN = 0x5B;
    public const ushort VK_RWIN = 0x5C;
    public const ushort VK_LSHIFT = 0xA0;
    public const ushort VK_RSHIFT = 0xA1;
    public const ushort VK_LCONTROL = 0xA2;
    public const ushort VK_RCONTROL = 0xA3;
    public const ushort VK_LMENU = 0xA4;
    public const ushort VK_RMENU = 0xA5;

    private static IntPtr ResolveTargetKeyboardLayout() {
        IntPtr fg = GetForegroundWindow();
        uint tid = fg != IntPtr.Zero ? GetThreadIdForHkl(fg, IntPtr.Zero) : 0;
        IntPtr hkl = GetKeyboardLayout(tid);
        if (hkl == IntPtr.Zero) hkl = GetKeyboardLayout(0);
        return hkl;
    }

    private static bool SendKeyEvent(ushort vk, ushort scan, uint flags) {
        int cb = Marshal.SizeOf(typeof(KBD_INPUT));
        KBD_INPUT[] inputs = new KBD_INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.ki.wVk = vk;
        inputs[0].U.ki.wScan = scan;
        inputs[0].U.ki.dwFlags = flags;
        return SendInput(1, inputs, cb) == 1;
    }

    public static void ReleaseHeldModifiers() {
        IntPtr hkl = ResolveTargetKeyboardLayout();
        ushort[] mods = new ushort[] {
            VK_SHIFT, VK_LSHIFT, VK_RSHIFT,
            VK_CONTROL, VK_LCONTROL, VK_RCONTROL,
            VK_MENU, VK_LMENU, VK_RMENU,
            VK_LWIN, VK_RWIN
        };
        bool released = false;
        for (int i = 0; i < mods.Length; i++) {
            if ((GetAsyncKeyState(mods[i]) & 0x8000) != 0) {
                ushort scan = (ushort)(MapVirtualKeyExW(mods[i], 0, hkl) & 0xFF);
                SendKeyEvent(mods[i], scan, KEYEVENTF_KEYUP);
                released = true;
            }
        }
        if (released) System.Threading.Thread.Sleep(6);
    }

    public static bool SendVirtualKey(ushort vk) {
        IntPtr hkl = ResolveTargetKeyboardLayout();
        ushort scan = (ushort)(MapVirtualKeyExW(vk, 0, hkl) & 0xFF);
        bool downOk = SendKeyEvent(vk, scan, 0);
        System.Threading.Thread.Sleep(2);
        bool upOk = SendKeyEvent(vk, scan, KEYEVENTF_KEYUP);
        return downOk && upOk;
    }

    public static void SendAltTap() {
        SendVirtualKey(VK_MENU);
    }

    private static bool SendSingleUnicodeChar(char ch, char lo, bool hasSurrogate, int unicodeDelayMs) {
        int cb = Marshal.SizeOf(typeof(KBD_INPUT));
        if (hasSurrogate) {
            KBD_INPUT[] down = new KBD_INPUT[2];
            down[0].type = INPUT_KEYBOARD; down[0].U.ki.wScan = (ushort)ch; down[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
            down[1].type = INPUT_KEYBOARD; down[1].U.ki.wScan = (ushort)lo; down[1].U.ki.dwFlags = KEYEVENTF_UNICODE;
            uint dSent = SendInput(2, down, cb);
            System.Threading.Thread.Sleep(4);
            KBD_INPUT[] up = new KBD_INPUT[2];
            up[0].type = INPUT_KEYBOARD; up[0].U.ki.wScan = (ushort)ch; up[0].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            up[1].type = INPUT_KEYBOARD; up[1].U.ki.wScan = (ushort)lo; up[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            uint uSent = SendInput(2, up, cb);
            if (unicodeDelayMs > 0) System.Threading.Thread.Sleep(unicodeDelayMs);
            return dSent == 2 && uSent == 2;
        }
        bool singleDown = SendKeyEvent(0, (ushort)ch, KEYEVENTF_UNICODE);
        System.Threading.Thread.Sleep(4);
        bool singleUp = SendKeyEvent(0, (ushort)ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        if (unicodeDelayMs > 0) System.Threading.Thread.Sleep(unicodeDelayMs);
        return singleDown && singleUp;
    }

    public static int SendUnicodeLine(string text, int vkDelayMs, int unicodeDelayMs) {
        if (string.IsNullOrEmpty(text)) return 0;
        if (vkDelayMs <= 0) vkDelayMs = 4;
        if (unicodeDelayMs <= 0) unicodeDelayMs = 20;

        ReleaseHeldModifiers();
        IntPtr hkl = ResolveTargetKeyboardLayout();
        ushort shiftScan = (ushort)(MapVirtualKeyExW(VK_LSHIFT, 0, hkl) & 0xFF);
        bool capsOn = (GetKeyState(VK_CAPITAL) & 1) != 0;
        int sentChars = 0;

        for (int i = 0; i < text.Length; i++) {
            char c = text[i];
            if (c == '\r') continue;
            if (c == '\t') {
                if (SendVirtualKey(VK_TAB)) sentChars++;
                System.Threading.Thread.Sleep(vkDelayMs);
                continue;
            }
            if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) {
                if (SendSingleUnicodeChar(c, text[i + 1], true, unicodeDelayMs)) sentChars++;
                i++;
                continue;
            }

            short vkRes = VkKeyScanExW(c, hkl);
            int shiftState = (vkRes >> 8) & 0xFF;
            ushort vk = (ushort)(vkRes & 0xFF);
            bool isDeadKey = vkRes != -1 && vk != 0 && (MapVirtualKeyExW(vk, 2, hkl) & 0x80000000u) != 0;

            if (vkRes != -1 && vk != 0 && !isDeadKey && (shiftState & 6) == 0) {
                bool needShift = (shiftState & 1) != 0;
                if (capsOn && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) {
                    needShift = !needShift;
                }
                ushort scan = (ushort)(MapVirtualKeyExW(vk, 0, hkl) & 0xFF);
                if (needShift) {
                    SendKeyEvent(VK_LSHIFT, shiftScan, 0);
                    System.Threading.Thread.Sleep(2);
                }
                bool downOk = SendKeyEvent(vk, scan, 0);
                System.Threading.Thread.Sleep(1);
                bool upOk = SendKeyEvent(vk, scan, KEYEVENTF_KEYUP);
                if (needShift) {
                    System.Threading.Thread.Sleep(2);
                    SendKeyEvent(VK_LSHIFT, shiftScan, KEYEVENTF_KEYUP);
                }
                if (downOk && upOk) sentChars++;
                System.Threading.Thread.Sleep(vkDelayMs);
            } else {
                if (SendSingleUnicodeChar(c, '\0', false, unicodeDelayMs)) sentChars++;
            }
        }
        return sentChars;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT Point);

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    public static void EnsureDpiAware() {
        try {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return;
        } catch {}
        try {
            SetProcessDPIAware();
        } catch {}
    }

    public static bool IsWindowCloaked(IntPtr hWnd) {
        try {
            int cloaked = 0;
            int hr = DwmGetWindowAttribute(hWnd, 14, out cloaked, Marshal.SizeOf(typeof(int)));
            return hr == 0 && cloaked != 0;
        } catch {
            return false;
        }
    }

    public static void RaiseWindowZOrder(IntPtr hWnd) {
        IntPtr HWND_TOPMOST = new IntPtr(-1);
        IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        const uint flags = 0x0001 | 0x0002 | 0x0040; // SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW
        SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
        SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
    }

    public static uint GetWindowPidAtPoint(int x, int y) {
        POINT pt;
        pt.X = x;
        pt.Y = y;
        IntPtr hit = WindowFromPoint(pt);
        if (hit == IntPtr.Zero) return 0;
        IntPtr root = GetAncestor(hit, 2); // GA_ROOT
        if (root != IntPtr.Zero) hit = root;
        uint pid = 0;
        GetWindowThreadProcessId(hit, out pid);
        return pid;
    }

    public class WindowInfo {
        public IntPtr Handle;
        public uint Pid;
        public string Title;
    }

    public static WindowInfo[] GetVisibleWindows() {
        var list = new System.Collections.Generic.List<WindowInfo>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;
            if (IsWindowCloaked(hWnd)) return true;
            StringBuilder sb = new StringBuilder(512);
            int len = GetWindowText(hWnd, sb, 512);
            if (len <= 0) return true;
            string title = sb.ToString().Trim();
            if (string.IsNullOrEmpty(title)) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            list.Add(new WindowInfo { Handle = hWnd, Pid = pid, Title = title });
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;

    public static void ScrollWheel(int delta) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta), 0);
    }

    public static bool SendCtrlEnter() {
        IntPtr hkl = ResolveTargetKeyboardLayout();
        ushort ctrlScan = (ushort)(MapVirtualKeyExW(VK_LCONTROL, 0, hkl) & 0xFF);
        ushort retScan = (ushort)(MapVirtualKeyExW(VK_RETURN, 0, hkl) & 0xFF);
        SendKeyEvent(VK_LCONTROL, ctrlScan, 0);
        System.Threading.Thread.Sleep(15);
        bool downOk = SendKeyEvent(VK_RETURN, retScan, 0);
        System.Threading.Thread.Sleep(15);
        bool upOk = SendKeyEvent(VK_RETURN, retScan, KEYEVENTF_KEYUP);
        System.Threading.Thread.Sleep(15);
        SendKeyEvent(VK_LCONTROL, ctrlScan, KEYEVENTF_KEYUP);
        return downOk && upOk;
    }

    public static bool SendCtrlShortcut(char keyChar) {
        ReleaseHeldModifiers();
        IntPtr hkl = ResolveTargetKeyboardLayout();
        short vkRes = VkKeyScanExW(char.ToLowerInvariant(keyChar), hkl);
        ushort vk = (vkRes != -1 && (vkRes & 0xFF) != 0) ? (ushort)(vkRes & 0xFF) : (ushort)char.ToUpperInvariant(keyChar);
        ushort ctrlScan = (ushort)(MapVirtualKeyExW(VK_LCONTROL, 0, hkl) & 0xFF);
        ushort keyScan = (ushort)(MapVirtualKeyExW(vk, 0, hkl) & 0xFF);
        SendKeyEvent(VK_LCONTROL, ctrlScan, 0);
        System.Threading.Thread.Sleep(18);
        bool downOk = SendKeyEvent(vk, keyScan, 0);
        System.Threading.Thread.Sleep(18);
        bool upOk = SendKeyEvent(vk, keyScan, KEYEVENTF_KEYUP);
        System.Threading.Thread.Sleep(18);
        SendKeyEvent(VK_LCONTROL, ctrlScan, KEYEVENTF_KEYUP);
        return downOk && upOk;
    }
}
"@ -IgnoreWarnings
}

Add-Type -AssemblyName System.Windows.Forms

function Write-JsonResult($Obj) {
    $json = $Obj | ConvertTo-Json -Depth 5 -Compress
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    Write-Output ("__CREATER_B64__" + $b64 + "__END__")
}

function Focus-WindowHandle {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '')]
    param([IntPtr]$hwnd)
    if ($hwnd -eq [IntPtr]::Zero) { return }
    [DesktopNative]::AllowSetForegroundWindow(-1) | Out-Null
    if ([DesktopNative]::IsIconic($hwnd)) {
        [DesktopNative]::ShowWindow($hwnd, 9) | Out-Null # SW_RESTORE
    } else {
        [DesktopNative]::ShowWindow($hwnd, 5) | Out-Null # SW_SHOW
    }
    $fg = [DesktopNative]::GetForegroundWindow()
    $fgPid = [uint32]0
    $targetPid = [uint32]0
    $fgThread = if ($fg -ne [IntPtr]::Zero) { [DesktopNative]::GetWindowThreadProcessId($fg, [ref]$fgPid) } else { 0 }
    $targetThread = [DesktopNative]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
    $curThread = [DesktopNative]::GetCurrentThreadId()
    $attachedFg = $false
    $attachedTarget = $false
    try {
        if ($fgThread -ne 0 -and $fgThread -ne $curThread) {
            $attachedFg = [DesktopNative]::AttachThreadInput($curThread, $fgThread, $true)
        }
        if ($targetThread -ne 0 -and $targetThread -ne $curThread) {
            $attachedTarget = [DesktopNative]::AttachThreadInput($curThread, $targetThread, $true)
        }
        [DesktopNative]::RaiseWindowZOrder($hwnd)
        [DesktopNative]::BringWindowToTop($hwnd) | Out-Null
        [DesktopNative]::SetForegroundWindow($hwnd) | Out-Null
    } finally {
        if ($attachedTarget) { [DesktopNative]::AttachThreadInput($curThread, $targetThread, $false) | Out-Null }
        if ($attachedFg) { [DesktopNative]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null }
    }
}

function Get-WindowTitleSafe([IntPtr]$hwnd) {
    if ($hwnd -eq [IntPtr]::Zero) { return "" }
    $sb = New-Object System.Text.StringBuilder 256
    [DesktopNative]::GetWindowText($hwnd, $sb, 256) | Out-Null
    return $sb.ToString()
}

function Test-WindowForeground([IntPtr]$hwnd, [uint32]$targetPid) {
    $fg = [DesktopNative]::GetForegroundWindow()
    if ($fg -eq [IntPtr]::Zero) { return $false }
    if ($fg -eq $hwnd) { return $true }
    if ($targetPid -gt 0) {
        $fgPid = [uint32]0
        [DesktopNative]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
        if ($fgPid -eq $targetPid) { return $true }
    }
    return $false
}

function Ensure-WindowForeground {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '')]
    param([IntPtr]$hwnd, [uint32]$targetPid)
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        Focus-WindowHandle $hwnd
        Start-Sleep -Milliseconds 120
        if (Test-WindowForeground $hwnd $targetPid) {
            return $true
        }
        if ($attempt -eq 0) {
            [DesktopNative]::SendAltTap()
            Start-Sleep -Milliseconds 50
        }
    }
    return (Test-WindowForeground $hwnd $targetPid)
}

function Find-TargetWindow([string]$targetHint, [string]$siteHint) {
    $fgHwnd = [DesktopNative]::GetForegroundWindow()
    $windows = [DesktopNative]::GetVisibleWindows()
    $procNames = @{}
    $candidates = @()

    foreach ($w in $windows) {
        $pidKey = [int]$w.Pid
        if (-not $procNames.ContainsKey($pidKey)) {
            $p = Get-Process -Id $pidKey -ErrorAction SilentlyContinue
            $procNames[$pidKey] = if ($p) { $p.ProcessName } else { "" }
        }
        $pName = $procNames[$pidKey]
        $matchesTarget = $true
        $matchByProc = $false
        if (-not [string]::IsNullOrWhiteSpace($targetHint)) {
            if ($targetHint -match '^\d+$') {
                $matchesTarget = ($pidKey -eq [int]$targetHint)
                $matchByProc = $matchesTarget
            } else {
                $matchByProc = ($pName -like "*$targetHint*")
                $matchesTarget = $matchByProc -or ($w.Title -like "*$targetHint*")
            }
        }
        if ($matchesTarget) {
            $wr = New-Object DesktopNative+RECT
            [DesktopNative]::GetWindowRect($w.Handle, [ref]$wr) | Out-Null
            $wWidth = [int]($wr.Right - $wr.Left)
            $wHeight = [int]($wr.Bottom - $wr.Top)
            $candidates += [PSCustomObject]@{
                Handle = $w.Handle
                Pid = $pidKey
                ProcessName = $pName
                Title = $w.Title
                MatchByProc = $matchByProc
                IsForeground = ($w.Handle -eq $fgHwnd)
                Width = $wWidth
                Height = $wHeight
            }
        }
    }

    if ($candidates.Count -eq 0) { return $null }

    # Prefer actual target process matches over unrelated apps whose title happens to mention targetHint
    $procCandidates = @($candidates | Where-Object { $_.MatchByProc })
    if ($procCandidates.Count -gt 0) {
        $candidates = $procCandidates
    }

    # Prefer any Chrome/target window whose title matches the requested site hint (works across multiple profiles)
    if (-not [string]::IsNullOrWhiteSpace($siteHint)) {
        $siteHits = @($candidates | Where-Object {
            $cleanTitle = $_.Title -replace '\s*-\s*(Google Chrome|Chromium|Microsoft Edge)$', ''
            $cleanTitle -like "*$siteHint*"
        })
        if ($siteHits.Count -gt 0) {
            $fgHit = $siteHits | Where-Object { $_.IsForeground } | Select-Object -First 1
            if ($fgHit) { return $fgHit }
            $nonMinSizedHit = $siteHits | Where-Object { (-not [DesktopNative]::IsIconic($_.Handle)) -and $_.Width -ge 120 -and $_.Height -ge 80 } | Select-Object -First 1
            if ($nonMinSizedHit) { return $nonMinSizedHit }
            $nonMinHit = $siteHits | Where-Object { -not [DesktopNative]::IsIconic($_.Handle) } | Select-Object -First 1
            if ($nonMinHit) { return $nonMinHit }
            return ($siteHits | Select-Object -First 1)
        }
    }

    # Never yank an unrelated Chrome profile window on top of an already-focused matching window
    $fgMatch = $candidates | Where-Object { $_.IsForeground -and $_.Width -ge 120 -and $_.Height -ge 80 } | Select-Object -First 1
    if ($fgMatch) { return $fgMatch }

    # Prefer clean blank document windows (e.g. Untitled - Notepad) over leftover busy windows
    $untitledMatch = $candidates | Where-Object {
        (-not [DesktopNative]::IsIconic($_.Handle)) -and $_.Width -ge 120 -and $_.Height -ge 80 -and $_.Title -match '^(?:\*?Untitled|Document1)\b'
    } | Select-Object -First 1
    if ($untitledMatch) { return $untitledMatch }

    # Prefer the topmost non-minimized matching window with real visible dimensions (skip tiny/0x0 helper HWNDs)
    $nonMinSized = $candidates | Where-Object { (-not [DesktopNative]::IsIconic($_.Handle)) -and $_.Width -ge 120 -and $_.Height -ge 80 } | Select-Object -First 1
    if ($nonMinSized) { return $nonMinSized }

    $nonMinimized = $candidates | Where-Object { -not [DesktopNative]::IsIconic($_.Handle) } | Select-Object -First 1
    if ($nonMinimized) { return $nonMinimized }
    return ($candidates | Select-Object -First 1)
}

switch ($Action.ToLower()) {
    "move" {
        [DesktopNative]::SetCursorPos($X, $Y) | Out-Null
        $pt = New-Object DesktopNative+POINT
        [DesktopNative]::GetCursorPos([ref]$pt) | Out-Null
        Write-JsonResult ([PSCustomObject]@{
            success = $true
            action = "move"
            x = $pt.X
            y = $pt.Y
        })
        break
    }
    "click" {
        [DesktopNative]::SetCursorPos($X, $Y) | Out-Null
        Start-Sleep -Milliseconds 30
        if ($Button -eq "right") {
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        } elseif ($Button -eq "middle") {
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)
        } elseif ($Button -eq "double") {
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 80
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        } else {
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        }
        Write-JsonResult ([PSCustomObject]@{
            success = $true
            action = "click"
            button = $Button
            x = $X
            y = $Y
        })
        break
    }
    "clickandpaste" {
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        [DesktopNative]::SetCursorPos($X, $Y) | Out-Null
        Start-Sleep -Milliseconds 30
        [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 20
        [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 160

        # Verify the click actually focused an editable input before sending Ctrl+A / Ctrl+V
        $isEditable = $false
        $focusedRole = ""
        try {
            $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
            if ($focused) {
                $ct = $focused.Current.ControlType
                $focusedRole = if ($ct) { $ct.ProgrammaticName } else { "" }
                $vpObj = $null
                $hasWritableValue = $false
                $hasReadOnlyValue = $false
                if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpObj)) {
                    if ($vpObj.Current.IsReadOnly) {
                        $hasReadOnlyValue = $true
                    } else {
                        $hasWritableValue = $true
                    }
                }
                if ($hasWritableValue) {
                    $isEditable = $true
                } elseif (($ct -eq [System.Windows.Automation.ControlType]::Edit -or $ct -eq [System.Windows.Automation.ControlType]::ComboBox) -and -not $hasReadOnlyValue) {
                    $isEditable = $true
                } elseif ($ct -eq [System.Windows.Automation.ControlType]::Document) {
                    $focusRect = $focused.Current.BoundingRectangle
                    $tpObj = $null
                    $hasTextPattern = $focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tpObj)
                    $isCompactCompose = (-not [double]::IsInfinity($focusRect.Width) -and $focusRect.Width -gt 0 -and $focusRect.Width -le 1400 -and $focusRect.Height -gt 0 -and $focusRect.Height -le 480)
                    if ($isCompactCompose -or $hasTextPattern) {
                        $isEditable = $true
                    }
                } elseif ($focused.Current.IsKeyboardFocusable -and ($focused.Current.Name -match '(?i)(message|search|write|reply|comment|chat|to:)')) {
                    $isEditable = $true
                }
            }
        } catch {
            $isEditable = $false
        }

        if (-not $isEditable) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                action = "clickandpaste"
                x = $X
                y = $Y
                focusedRole = $focusedRole
                error = "Clicked element did not focus an editable input ($focusedRole)"
            })
            break
        }

        if (![string]::IsNullOrEmpty($Text)) {
            [System.Windows.Forms.Clipboard]::SetText($Text)
            Start-Sleep -Milliseconds 40
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 50
            [System.Windows.Forms.SendKeys]::SendWait("^v")
        }
        if (![string]::IsNullOrEmpty($Key)) {
            Start-Sleep -Milliseconds 110
            [System.Windows.Forms.SendKeys]::SendWait($Key)
        }
        Write-JsonResult ([PSCustomObject]@{
            success = $true
            action = "clickandpaste"
            x = $X
            y = $Y
            focusedRole = $focusedRole
            textLength = $Text.Length
        })
        break
    }
    "type" {
        if (![string]::IsNullOrEmpty($Text)) {
            try {
                [System.Windows.Forms.SendKeys]::SendWait($Text)
            } catch {
                try {
                    $wshell = New-Object -ComObject WScript.Shell
                    $wshell.SendKeys($Text)
                } catch {
                    $null = $_
                }
            }
        }
        Write-JsonResult ([PSCustomObject]@{
            success = $true
            action = "type"
            textLength = $Text.Length
        })
        break
    }
    "key" {
        if (![string]::IsNullOrEmpty($Key)) {
            try {
                [System.Windows.Forms.SendKeys]::SendWait($Key)
            } catch {
                try {
                    $wshell = New-Object -ComObject WScript.Shell
                    $wshell.SendKeys($Key)
                } catch {
                    $null = $_
                }
            }
        }
        Write-JsonResult ([PSCustomObject]@{
            success = $true
            action = "key"
            key = $Key
        })
        break
    }
    "getactivewindow" {
        $hwnd = [DesktopNative]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 512
        [DesktopNative]::GetWindowText($hwnd, $sb, 512) | Out-Null
        $pidOut = 0
        [DesktopNative]::GetWindowThreadProcessId($hwnd, [ref]$pidOut) | Out-Null
        $rect = New-Object DesktopNative+RECT
        [DesktopNative]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

        $title = $sb.ToString().Trim()
        $procName = ""
        if ($pidOut -gt 0) {
            try {
                $p = Get-Process -Id $pidOut -ErrorAction SilentlyContinue
                if ($p) {
                    $procName = $p.ProcessName
                    if ([string]::IsNullOrWhiteSpace($title)) {
                        if (![string]::IsNullOrWhiteSpace($p.MainWindowTitle)) {
                            $title = $p.MainWindowTitle.Trim()
                        } else {
                            $title = $procName
                        }
                    }
                }
            } catch { $null = $_ }
        }

        # Enumerate known user desktop GUI applications
        $openApps = @()
        try {
            $knownGui = @('chrome', 'msedge', 'firefox', 'code', 'Antigravity IDE', 'notepad', 'spotify', 'explorer', 'WindowsTerminal', 'cmd', 'powershell')
            $procs = Get-Process | Where-Object {
                ($_.MainWindowTitle -ne '') -or ($knownGui -contains $_.ProcessName)
            }
            foreach ($pr in $procs) {
                $displayName = if (![string]::IsNullOrWhiteSpace($pr.MainWindowTitle)) { $pr.MainWindowTitle.Trim() } else { $pr.ProcessName }
                if (![string]::IsNullOrWhiteSpace($displayName) -and ($openApps -notcontains $displayName)) {
                    $openApps += $displayName
                }
            }
        } catch { $null = $_ }

        Write-JsonResult ([PSCustomObject]@{
            success = $true
            hwnd = $hwnd.ToInt64()
            title = $title
            process = $procName
            pid = $pidOut
            openApps = $openApps
            bounds = [PSCustomObject]@{
                x = $rect.Left
                y = $rect.Top
                width = [Math]::Max(0, $rect.Right - $rect.Left)
                height = [Math]::Max(0, $rect.Bottom - $rect.Top)
            }
        })
        break
    }
    "focuswindow" {
        [DesktopNative]::EnsureDpiAware()
        $found = Find-TargetWindow $TargetWindow $SiteHint

        if ($found) {
            if (-not $found.IsForeground) {
                Focus-WindowHandle $found.Handle
            }
            Write-JsonResult ([PSCustomObject]@{
                success = $true
                found = $true
                pid = $found.Pid
                title = $found.Title
            })
        } else {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $false
                message = "Window matching '$TargetWindow' not found"
            })
        }
        break
    }
    "inspectbrowser" {
        $totalSw = [System.Diagnostics.Stopwatch]::StartNew()
        $uiaLatencyMs = 0
        $ocrLatencyMs = 0
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Runtime.WindowsRuntime

        $targetHint = if ([string]::IsNullOrWhiteSpace($TargetWindow)) { "chrome" } else { $TargetWindow }
        $matchWin = Find-TargetWindow $targetHint $SiteHint
        $hwnd = if ($matchWin) { $matchWin.Handle } else { [DesktopNative]::GetForegroundWindow() }
        if ($matchWin -and -not $matchWin.IsForeground) {
            Focus-WindowHandle $hwnd
            Start-Sleep -Milliseconds 120
        }

        $sb = New-Object System.Text.StringBuilder 512
        [DesktopNative]::GetWindowText($hwnd, $sb, 512) | Out-Null
        $winTitle = $sb.ToString().Trim()
        $rect = New-Object DesktopNative+RECT
        [DesktopNative]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
        $winLeft = [int]$rect.Left
        $winTop = [int]$rect.Top
        $winWidth = [Math]::Max(1, [int]($rect.Right - $rect.Left))
        $winHeight = [Math]::Max(1, [int]($rect.Bottom - $rect.Top))

        # Web viewport starts below browser tabs & omnibox (~95px from top)
        $chromeHeaderOffset = 95
        $contentTop = $winTop + $chromeHeaderOffset
        $contentHeight = [Math]::Max(50, $winHeight - $chromeHeaderOffset - 10)
        $elements = New-Object System.Collections.ArrayList

        # 1. Windows UI Automation inspection (Edit, Button, Hyperlink, ListItem, ComboBox, Document, Text, CheckBox, RadioButton, TabItem)
        $uiaSw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $autoRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
            if ($autoRoot) {
                $conds = @(
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Hyperlink)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ComboBox)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::RadioButton)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem))
                )
                $orCond = New-Object System.Windows.Automation.OrCondition($conds)
                $found = $autoRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $orCond)
                $uiaCount = 0
                foreach ($el in $found) {
                    if ($uiaCount -ge 110) { break }
                    try {
                        $cur = $el.Current
                        if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
                        $br = $cur.BoundingRectangle
                        if ([double]::IsInfinity($br.Left) -or [double]::IsNaN($br.Left)) { continue }
                        $w = [int]$br.Width
                        $h = [int]$br.Height
                        $top = [int]$br.Top
                        $left = [int]$br.Left
                        if ($w -lt 12 -or $h -lt 10 -or $top -lt $contentTop) { continue }
                        if ($left -lt ($winLeft - 5) -or $left -gt ($winLeft + $winWidth)) { continue }
                        $name = if ($cur.Name) { $cur.Name.Trim() } else { "" }
                        $ct = $cur.ControlType.ProgrammaticName -replace '^ControlType\.', ''
                        if ($ct -eq "Document" -and $w -gt ($winWidth * 0.7) -and $h -gt ($contentHeight * 0.6)) { continue }
                        if ($ct -eq "Text" -and ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 95)) { continue }
                        $isMediaCard = ($ct -eq "Hyperlink" -or $ct -eq "Button") -and $w -ge 90 -and $h -ge 90
                        if ([string]::IsNullOrWhiteSpace($name)) {
                            if ($isMediaCard) {
                                $name = "media-card"
                            } elseif ($ct -ne "Edit" -and $ct -ne "Document" -and $ct -ne "ComboBox" -and $ct -ne "CheckBox" -and $ct -ne "RadioButton") {
                                continue
                            }
                        }
                        $uiaCount++
                        $null = $elements.Add([PSCustomObject]@{
                            source = "uia"
                            role = $ct.ToLower()
                            name = $name
                            text = $name
                            x = [int]($left + ($w / 2))
                            y = [int]($top + ($h / 2))
                            width = $w
                            height = $h
                            isFocused = [bool]$cur.HasKeyboardFocus
                        })
                    } catch { $null = $_ }
                }
            }
        } catch { $null = $_ }
        $uiaSw.Stop()
        $uiaLatencyMs = [int]$uiaSw.ElapsedMilliseconds

        # 2. Windows built-in WinRT OCR over the webpage viewport
        $ocrSw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
                $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
            })[0]
            function Invoke-WinRtAwait($WinRtTask, $ResultType) {
                $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
                $netTask = $asTask.Invoke($null, @($WinRtTask))
                $netTask.Wait(4000) | Out-Null
                return $netTask.Result
            }
            $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
            $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
            $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]

            $bmp = New-Object System.Drawing.Bitmap($winWidth, $contentHeight)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.CopyFromScreen($winLeft, $contentTop, 0, 0, $bmp.Size)
            $g.Dispose()

            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            $bytes = $ms.ToArray()
            $ms.Dispose()

            $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
            $writer = New-Object Windows.Storage.Streams.DataWriter($ras.GetOutputStreamAt(0))
            $writer.WriteBytes($bytes)
            $null = Invoke-WinRtAwait ($writer.StoreAsync()) ([uint32])
            $null = Invoke-WinRtAwait ($writer.FlushAsync()) ([bool])
            $decoder = Invoke-WinRtAwait ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $sbmp = Invoke-WinRtAwait ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
            if ($ocrEngine) {
                $ocrRes = Invoke-WinRtAwait ($ocrEngine.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
                $ocrCount = 0
                foreach ($line in $ocrRes.Lines) {
                    if ($ocrCount -ge 65) { break }
                    $words = @($line.Words)
                    if ($words.Count -eq 0) { continue }
                    $minX = [int]::MaxValue; $minY = [int]::MaxValue
                    $maxX = [int]::MinValue; $maxY = [int]::MinValue
                    foreach ($wObj in $words) {
                        $br = $wObj.BoundingRect
                        $wx = [int]($br.X); $wy = [int]($br.Y)
                        $ww = [int]($br.Width); $wh = [int]($br.Height)
                        if ($wx -lt $minX) { $minX = $wx }
                        if ($wy -lt $minY) { $minY = $wy }
                        if (($wx + $ww) -gt $maxX) { $maxX = $wx + $ww }
                        if (($wy + $wh) -gt $maxY) { $maxY = $wy + $wh }
                    }
                    $boxW = [Math]::Max(1, $maxX - $minX)
                    $boxH = [Math]::Max(1, $maxY - $minY)
                    $lineText = $line.Text.Trim()
                    if ([string]::IsNullOrWhiteSpace($lineText)) { continue }
                    $ocrCount++
                    $null = $elements.Add([PSCustomObject]@{
                        source = "ocr"
                        role = "text"
                        name = $lineText
                        text = $lineText
                        x = [int]($winLeft + $minX + ($boxW / 2))
                        y = [int]($contentTop + $minY + ($boxH / 2))
                        width = $boxW
                        height = $boxH
                    })
                }
            }
            $ras.Dispose()
        } catch { $null = $_ }
        $ocrSw.Stop()
        $ocrLatencyMs = [int]$ocrSw.ElapsedMilliseconds
        $totalSw.Stop()

        Write-JsonResult ([PSCustomObject]@{
            success = $true
            title = $winTitle
            bounds = [PSCustomObject]@{
                x = $winLeft
                y = $winTop
                width = $winWidth
                height = $winHeight
            }
            uiaLatencyMs = $uiaLatencyMs
            ocrLatencyMs = $ocrLatencyMs
            totalLatencyMs = [int]$totalSw.ElapsedMilliseconds
            elements = [object[]]@($elements.ToArray())
        })
        break
    }
    "writeapp" {
        [DesktopNative]::EnsureDpiAware()
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        $payloadText = $Text
        if (![string]::IsNullOrWhiteSpace($TextBase64)) {
            $payloadText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
        }
        $payloadText = ($payloadText -replace "\r\n", "`n") -replace "\r", "`n"

        $targetHint = if ([string]::IsNullOrWhiteSpace($TargetWindow)) { "notepad" } else { $TargetWindow }
        $matchWin = Find-TargetWindow $targetHint $SiteHint
        if (-not $matchWin) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $false
                action = "writeapp"
                error = "Window matching '$targetHint' not found"
            })
            break
        }

        $hwnd = $matchWin.Handle
        $targetPid = [uint32]0
        [DesktopNative]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null

        if (-not (Ensure-WindowForeground $hwnd $targetPid)) {
            $fgHwnd = [DesktopNative]::GetForegroundWindow()
            $fgTitle = Get-WindowTitleSafe $fgHwnd
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                action = "writeapp"
                title = $matchWin.Title
                error = "Could not lock foreground focus onto '$($matchWin.Title)' (active window: '$fgTitle')"
            })
            break
        }

        $rect = New-Object DesktopNative+RECT
        [DesktopNative]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
        $winLeft = [int]$rect.Left
        $winTop = [int]$rect.Top
        $winWidth = [int]($rect.Right - $rect.Left)
        $winHeight = [int]($rect.Bottom - $rect.Top)
        if ($winWidth -lt 100 -or $winHeight -lt 80) {
            [DesktopNative]::ShowWindow($hwnd, 9) | Out-Null
            Start-Sleep -Milliseconds 120
            $null = Ensure-WindowForeground $hwnd $targetPid
            [DesktopNative]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
            $winLeft = [int]$rect.Left
            $winTop = [int]$rect.Top
            $winWidth = [int]($rect.Right - $rect.Left)
            $winHeight = [int]($rect.Bottom - $rect.Top)
        }
        $winWidth = [Math]::Max(220, $winWidth)
        $winHeight = [Math]::Max(180, $winHeight)

        # Safe interior client bounds (clear of title bar, Windows 11 tab close X, and window borders)
        $marginX = [Math]::Min(70, [int]($winWidth * 0.18))
        $topReserve = if ($winHeight -ge 280) { [Math]::Min(165, [Math]::Max(115, [int]($winHeight * 0.25))) } else { [int]($winHeight * 0.45) }
        $safeLeft = $winLeft + $marginX
        $safeRight = [Math]::Max($safeLeft + 10, $rect.Right - $marginX)
        $safeTop = $winTop + $topReserve
        $safeBottom = [Math]::Max($safeTop + 10, $rect.Bottom - 35)

        $clickX = [int](($safeLeft + $safeRight) / 2)
        $clickY = [int](($safeTop + $safeBottom) / 2)

        $bestEditor = $null
        for ($uiaTry = 0; $uiaTry -lt 5; $uiaTry++) {
            try {
                $autoRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
                if ($autoRoot) {
                    $editCond = New-Object System.Windows.Automation.OrCondition(
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))
                    )
                    $foundEditors = $autoRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
                    $bestScore = 0.0
                    foreach ($ed in $foundEditors) {
                        if (-not $ed.Current.IsEnabled -or $ed.Current.IsOffscreen) { continue }
                        $b = $ed.Current.BoundingRectangle
                        if ([double]::IsInfinity($b.Width) -or [double]::IsInfinity($b.Height) -or [double]::IsNaN($b.Width) -or [double]::IsNaN($b.Height)) { continue }
                        if ($b.Width -ge 120 -and $b.Height -ge 65) {
                            $isDoc = ($ed.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document)
                            $score = ($b.Width * $b.Height) * $(if ($isDoc) { 2.0 } else { 1.0 })
                            if ($score -gt $bestScore) {
                                $bestScore = $score
                                $bestEditor = $ed
                            }
                        }
                    }
                    if ($bestEditor) { break }
                }
            } catch { $null = $_ }
            Start-Sleep -Milliseconds 110
        }

        $editorAlreadyFocused = $false
        if ($bestEditor) {
            try {
                $eb = $bestEditor.Current.BoundingRectangle
                $candX = [int]($eb.Left + ($eb.Width * 0.5))
                $candY = [int]($eb.Top + ($eb.Height * 0.5))
                $clickX = [Math]::Min($safeRight, [Math]::Max($safeLeft, $candX))
                $clickY = [Math]::Min($safeBottom, [Math]::Max($safeTop, $candY))
                $bestEditor.SetFocus()
                Start-Sleep -Milliseconds 90
                if ($bestEditor.Current.HasKeyboardFocus) {
                    $editorAlreadyFocused = $true
                }
            } catch { $null = $_ }
        }

        if (-not $editorAlreadyFocused) {
            try {
                $focusedEl = [System.Windows.Automation.AutomationElement]::FocusedElement
                if ($focusedEl) {
                    $fct = $focusedEl.Current.ControlType
                    $fPid = [uint32]$focusedEl.Current.ProcessId
                    $isEditType = ($fct -eq [System.Windows.Automation.ControlType]::Document) -or ($fct -eq [System.Windows.Automation.ControlType]::Edit)
                    if ($isEditType -and ($fPid -eq $targetPid)) {
                        $editorAlreadyFocused = $true
                    } elseif ($isEditType -and $matchWin.ProcessName -and ($matchWin.ProcessName -notmatch 'chrome|msedge|firefox')) {
                        $fp = Get-Process -Id $fPid -ErrorAction SilentlyContinue
                        if ($fp -and $fp.ProcessName -eq $matchWin.ProcessName) {
                            $editorAlreadyFocused = $true
                        }
                    }
                }
            } catch { $null = $_ }
        }

        if (-not (Test-WindowForeground $hwnd $targetPid)) {
            $null = Ensure-WindowForeground $hwnd $targetPid
        }
        if (-not (Test-WindowForeground $hwnd $targetPid)) {
            $fgHwnd = [DesktopNative]::GetForegroundWindow()
            $fgTitle = Get-WindowTitleSafe $fgHwnd
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                action = "writeapp"
                title = $matchWin.Title
                error = "Target window '$($matchWin.Title)' lost focus before writing (active window: '$fgTitle')"
            })
            break
        }

        # Only click if UIA focus didn't already land inside the editor control, AND verify the target window is actually visible under (clickX, clickY)
        if (-not $editorAlreadyFocused) {
            $hitPid = [DesktopNative]::GetWindowPidAtPoint($clickX, $clickY)
            $hitMatchesTarget = ($hitPid -eq $targetPid)
            if (-not $hitMatchesTarget -and $hitPid -gt 0 -and $matchWin.ProcessName -and ($matchWin.ProcessName -notmatch 'chrome|msedge|firefox')) {
                $hp = Get-Process -Id $hitPid -ErrorAction SilentlyContinue
                if ($hp -and $hp.ProcessName -eq $matchWin.ProcessName) { $hitMatchesTarget = $true }
            }
            if (-not $hitMatchesTarget) {
                [DesktopNative]::RaiseWindowZOrder($hwnd)
                Start-Sleep -Milliseconds 90
                $hitPid = [DesktopNative]::GetWindowPidAtPoint($clickX, $clickY)
                $hitMatchesTarget = ($hitPid -eq $targetPid)
                if (-not $hitMatchesTarget -and $hitPid -gt 0 -and $matchWin.ProcessName -and ($matchWin.ProcessName -notmatch 'chrome|msedge|firefox')) {
                    $hp = Get-Process -Id $hitPid -ErrorAction SilentlyContinue
                    if ($hp -and $hp.ProcessName -eq $matchWin.ProcessName) { $hitMatchesTarget = $true }
                }
            }
            if (-not $hitMatchesTarget) {
                $hpName = if ($hitPid -gt 0) { (Get-Process -Id $hitPid -ErrorAction SilentlyContinue).ProcessName } else { "none" }
                Write-JsonResult ([PSCustomObject]@{
                    success = $false
                    found = $true
                    action = "writeapp"
                    title = $matchWin.Title
                    error = "Target window '$($matchWin.Title)' is occluded at ($clickX,$clickY) by '$hpName' (rect=$winLeft,$winTop,$winWidth,$winHeight)"
                })
                break
            }

            [DesktopNative]::SetCursorPos($clickX, $clickY) | Out-Null
            Start-Sleep -Milliseconds 30
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 110

            if (-not (Test-WindowForeground $hwnd $targetPid)) {
                $fgHwnd = [DesktopNative]::GetForegroundWindow()
                $fgTitle = Get-WindowTitleSafe $fgHwnd
                Write-JsonResult ([PSCustomObject]@{
                    success = $false
                    found = $true
                    action = "writeapp"
                    title = $matchWin.Title
                    error = "Target window '$($matchWin.Title)' is not foreground after click (active window: '$fgTitle')"
                })
                break
            }
        }

        $readEditorTextSafe = {
            try {
                $el = [System.Windows.Automation.AutomationElement]::FocusedElement
                if (-not $el) { return $null }
                $tpObj = $null
                if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tpObj) -and $tpObj -and $tpObj.DocumentRange) {
                    return [string]$tpObj.DocumentRange.GetText(-1)
                }
                $vpObj = $null
                if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpObj) -and $vpObj) {
                    return [string]$vpObj.Current.Value
                }
            } catch { $null = $_ }
            return $null
        }

        $totalChars = $payloadText.Length
        $typedChars = 0
        $abortedMidWrite = $false
        $abortError = ""
        $beforeEditorText = & $readEditorTextSafe
        $initialBeforeCompact = if ($null -ne $beforeEditorText) { ($beforeEditorText -replace "\s+", "") } else { "" }

        # If targeting Windows 11 Tabbed Notepad and the focused tab already has leftover text,
        # press Ctrl+N to open a fresh blank Untitled tab before typing so old dirty tabs never corrupt output
        if ($initialBeforeCompact.Length -gt 0 -and ($matchWin.ProcessName -match '(?i)^notepad$' -or $matchWin.Title -match '(?i)notepad')) {
            [DesktopNative]::SendCtrlShortcut('N') | Out-Null
            Start-Sleep -Milliseconds 360
            $beforeEditorText = & $readEditorTextSafe
        }

        if ($totalChars -gt 0) {
            $vkDelayMs = if ($totalChars -le 450) { 4 } else { 3 }
            $unicodeDelayMs = 20
            $lines = $payloadText -split "`n", -1
            for ($li = 0; $li -lt $lines.Length; $li++) {
                if (-not (Test-WindowForeground $hwnd $targetPid)) {
                    $fgHwnd = [DesktopNative]::GetForegroundWindow()
                    $fgTitle = Get-WindowTitleSafe $fgHwnd
                    $abortedMidWrite = $true
                    $abortError = "Focus shifted to '$fgTitle' while typing into '$($matchWin.Title)' ($($li)/$($lines.Length) lines)"
                    break
                }
                $line = $lines[$li]
                if ($line.Length -gt 0) {
                    $typedChars += [DesktopNative]::SendUnicodeLine($line, $vkDelayMs, $unicodeDelayMs)
                }
                if ($li -lt ($lines.Length - 1)) {
                    [DesktopNative]::SendVirtualKey([DesktopNative]::VK_RETURN) | Out-Null
                    $typedChars += 1
                    Start-Sleep -Milliseconds 20
                }
            }
            Start-Sleep -Milliseconds 180
        }

        if ($abortedMidWrite) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                action = "writeapp"
                method = "sendinput_direct"
                title = $matchWin.Title
                textLength = $totalChars
                typedChars = $typedChars
                error = $abortError
            })
            break
        }

        $afterEditorText = & $readEditorTextSafe
        $verified = $false
        if ($null -ne $afterEditorText -and $totalChars -gt 0) {
            $expectedCompact = ($payloadText -replace "\s+", "")
            $afterCompact = ($afterEditorText -replace "\s+", "")
            $beforeCompact = if ($null -ne $beforeEditorText) { ($beforeEditorText -replace "\s+", "") } else { "" }

            $verifyError = ""
            if ($expectedCompact.Length -gt 0 -and $afterCompact.Length -eq 0) {
                $verifyError = "Editor '$($matchWin.Title)' remained empty after typing $totalChars chars"
            } elseif ($expectedCompact.Length -ge 6) {
                if ($afterCompact.Contains($expectedCompact)) {
                    $verified = $true
                } else {
                    # Compute ordered subsequence match across full document (handles insertion at top, middle, or bottom)
                    $si = 0
                    $ei = 0
                    while ($ei -lt $expectedCompact.Length -and $si -lt $afterCompact.Length) {
                        if ($expectedCompact[$ei] -eq $afterCompact[$si]) {
                            $ei++
                        }
                        $si++
                    }
                    $matchRatio = $ei / [double]$expectedCompact.Length
                    if ($beforeCompact.Length -eq 0) {
                        $maxLen = [int]($expectedCompact.Length * 1.35) + 6
                        $minLen = [int]($expectedCompact.Length * 0.75)
                        if ($matchRatio -lt 0.85 -or $afterCompact.Length -gt $maxLen -or $afterCompact.Length -lt $minLen) {
                            $verifyError = "Typed text mismatch in '$($matchWin.Title)' (expected ~$($expectedCompact.Length) non-space chars, got $($afterCompact.Length), ordered match $([Math]::Round($matchRatio * 100))%)"
                        } else {
                            $verified = $true
                        }
                    } else {
                        $growth = $afterCompact.Length - $beforeCompact.Length
                        $minGrowth = [int]($expectedCompact.Length * 0.70)
                        if ($growth -lt $minGrowth -or $matchRatio -lt 0.85) {
                            $verifyError = "Typed text mismatch while appending to '$($matchWin.Title)' (growth $growth/$($expectedCompact.Length), ordered match $([Math]::Round($matchRatio * 100))%)"
                        } else {
                            $verified = $true
                        }
                    }
                }
            } else {
                $verified = $afterCompact.Contains($expectedCompact)
                if (-not $verified) {
                    $verifyError = "Typed short text did not match content in '$($matchWin.Title)'"
                }
            }

            if (-not [string]::IsNullOrEmpty($verifyError)) {
                Write-JsonResult ([PSCustomObject]@{
                    success = $false
                    found = $true
                    action = "writeapp"
                    method = "sendinput_direct"
                    title = $matchWin.Title
                    textLength = $totalChars
                    typedChars = $typedChars
                    verified = $false
                    error = $verifyError
                })
                break
            }
        }

        Write-JsonResult ([PSCustomObject]@{
            success = $true
            found = $true
            action = "writeapp"
            method = "sendinput_direct"
            title = $matchWin.Title
            textLength = $totalChars
            typedChars = $typedChars
            verified = $verified
        })
        break
    }
    "youtubecomment" {
        [DesktopNative]::EnsureDpiAware()
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Runtime.WindowsRuntime

        $payloadText = $Text
        if (![string]::IsNullOrWhiteSpace($TextBase64)) {
            $payloadText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
        }
        $payloadText = (($payloadText -replace "\r\n", "`n") -replace "\r", "`n").Trim()
        if ([string]::IsNullOrWhiteSpace($payloadText)) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                status = "FAILED"
                action = "youtubecomment"
                error = "Comment text is empty"
            })
            break
        }

        if ($Approved -eq "false" -or $Approved -eq "rejected") {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                status = "FAILED"
                approved = $false
                action = "youtubecomment"
                comment = $payloadText
                error = "User rejected YouTube comment publication"
            })
            break
        }

        $targetHint = if ([string]::IsNullOrWhiteSpace($TargetWindow)) { "chrome" } else { $TargetWindow }
        $siteQuery = if ([string]::IsNullOrWhiteSpace($SiteHint)) { "YouTube" } else { $SiteHint }
        $matchWin = Find-TargetWindow $targetHint $siteQuery
        if (-not $matchWin) {
            $matchWin = Find-TargetWindow $targetHint "YouTube"
        }
        if (-not $matchWin) {
            $matchWin = Find-TargetWindow $targetHint ""
        }
        if (-not $matchWin) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $false
                action = "youtubecomment"
                error = "Browser window matching '$targetHint' not found"
            })
            break
        }

        $hwnd = $matchWin.Handle
        $targetPid = [uint32]0
        [DesktopNative]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
        if (-not (Ensure-WindowForeground $hwnd $targetPid)) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                action = "youtubecomment"
                title = $matchWin.Title
                error = "Could not focus browser window '$($matchWin.Title)'"
            })
            break
        }

        $rect = New-Object DesktopNative+RECT
        [DesktopNative]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
        $winLeft = [int]$rect.Left
        $winTop = [int]$rect.Top
        $winWidth = [Math]::Max(400, [int]($rect.Right - $rect.Left))
        $winHeight = [Math]::Max(300, [int]($rect.Bottom - $rect.Top))
        $contentTop = $winTop + 105
        $mainColRight = $winLeft + [int]($winWidth * 0.68)

        # Hover over the primary left/center watch column without clicking (so video playback is not paused)
        $scrollX = $winLeft + [int]($winWidth * 0.34)
        $scrollY = $winTop + [int]($winHeight * 0.55)
        [DesktopNative]::SetCursorPos($scrollX, $scrollY) | Out-Null
        Start-Sleep -Milliseconds 120

        # Warm up Chrome UIA tree
        try {
            $warmRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
            if ($warmRoot) {
                $null = $warmRoot.Current.Name
            }
        } catch { $null = $_ }

        $boxX = 0
        $boxY = 0
        $hdrX = 0
        $hdrY = 0

        for ($attempt = 0; $attempt -lt 4; $attempt++) {
            $wheelDelta = if ($attempt -eq 0) { -620 } elseif ($attempt -eq 1) { -500 } elseif ($attempt -eq 2) { -380 } else { 0 }
            if ($wheelDelta -ne 0) {
                [DesktopNative]::SetCursorPos($scrollX, $scrollY) | Out-Null
                [DesktopNative]::ScrollWheel($wheelDelta)
                Start-Sleep -Milliseconds 950
            } else {
                Start-Sleep -Milliseconds 400
            }

            # 1. Search UIA tree for "Add a comment..." placeholder or editable box
            try {
                $autoRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
                if ($autoRoot) {
                    $conds = @(
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)),
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Group)),
                        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Custom))
                    )
                    $orCond = New-Object System.Windows.Automation.OrCondition($conds)
                    $found = $autoRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $orCond)
                    foreach ($el in $found) {
                        try {
                            $cur = $el.Current
                            if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
                            $br = $cur.BoundingRectangle
                            if ([double]::IsInfinity($br.Left) -or [double]::IsNaN($br.Left)) { continue }
                            $left = [int]$br.Left
                            $top = [int]$br.Top
                            $w = [int]$br.Width
                            $h = [int]$br.Height
                            if ($w -lt 20 -or $h -lt 10 -or $top -lt $contentTop -or $top -gt ($winTop + $winHeight - 35)) { continue }
                            if ($left -lt $winLeft -or $left -gt $mainColRight) { continue }
                            $elName = if ($cur.Name) { $cur.Name.Trim() } else { "" }
                            if ($elName -match '(?i)(add\s+a\s+comment|public\s+comment|write\s+a\s+comment|comment\s+as\b)') {
                                $boxX = [int]($left + [Math]::Min(120, [int]($w * 0.35)))
                                $boxY = [int]($top + ($h / 2))
                                break
                            }
                            if ($hdrY -eq 0 -and $elName -match '^(?i)(\d[\d,\.]*\s+)?comments?$') {
                                $hdrX = $left
                                $hdrY = [int]($top + $h)
                            }
                        } catch { $null = $_ }
                    }
                }
            } catch { $null = $_ }

            if ($boxX -gt 0 -and $boxY -gt 0) { break }

            # 2. Fallback to WinRT OCR on the primary watch column
            try {
                $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
                    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
                })[0]
                function Invoke-WinRtOcrAwait($WinRtTask, $ResultType) {
                    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
                    $netTask = $asTask.Invoke($null, @($WinRtTask))
                    $netTask.Wait(3500) | Out-Null
                    return $netTask.Result
                }
                $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
                $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
                $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]

                $capW = [Math]::Max(200, $mainColRight - $winLeft)
                $capH = [Math]::Max(150, ($winTop + $winHeight) - $contentTop - 20)
                $bmp = New-Object System.Drawing.Bitmap($capW, $capH)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($winLeft, $contentTop, 0, 0, $bmp.Size)
                $g.Dispose()

                $ms = New-Object System.IO.MemoryStream
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()
                $bytes = $ms.ToArray()
                $ms.Dispose()

                $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
                $writer = New-Object Windows.Storage.Streams.DataWriter($ras.GetOutputStreamAt(0))
                $writer.WriteBytes($bytes)
                $null = Invoke-WinRtOcrAwait ($writer.StoreAsync()) ([uint32])
                $null = Invoke-WinRtOcrAwait ($writer.FlushAsync()) ([bool])
                $decoder = Invoke-WinRtOcrAwait ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
                $sbmp = Invoke-WinRtOcrAwait ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
                $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
                if ($ocrEngine) {
                    $ocrRes = Invoke-WinRtOcrAwait ($ocrEngine.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
                    foreach ($line in $ocrRes.Lines) {
                        $txt = $line.Text.Trim()
                        if ([string]::IsNullOrWhiteSpace($txt)) { continue }
                        $words = @($line.Words)
                        if ($words.Count -eq 0) { continue }
                        $minX = [int]$words[0].BoundingRect.X
                        $minY = [int]$words[0].BoundingRect.Y
                        $maxH = [int]$words[0].BoundingRect.Height
                        if ($txt -match '(?i)add\s+a\s+comment') {
                            $boxX = $winLeft + $minX + 60
                            $boxY = $contentTop + $minY + [int]($maxH / 2)
                            break
                        }
                        if ($txt -match '(?i)^\d[\d,\.]*\s+comments?\b' -or $txt -match '^(?i)comments?$') {
                            $hdrX = $winLeft + $minX
                            $hdrY = $contentTop + $minY + $maxH
                        }
                    }
                }
                $ras.Dispose()
            } catch { $null = $_ }

            if ($boxX -gt 0 -and $boxY -gt 0) { break }
            if ($attempt -ge 1 -and $hdrY -gt 0 -and ($hdrY + 60) -lt ($winTop + $winHeight - 45)) {
                $boxX = $hdrX + 95
                $boxY = $hdrY + 56
                break
            }
        }

        if ($boxX -le 0 -or $boxY -le 0) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                action = "youtubecomment"
                title = $matchWin.Title
                error = "Could not locate YouTube comment input box on screen"
            })
            break
        }

        $null = Ensure-WindowForeground $hwnd $targetPid
        [DesktopNative]::SetCursorPos($boxX, $boxY) | Out-Null
        Start-Sleep -Milliseconds 40
        [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 25
        [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 520

        # Ensure the expanded YouTube comment box has focus
        try {
            $autoRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
            if ($autoRoot) {
                $editCond = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                )
                $edits = $autoRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
                foreach ($ed in $edits) {
                    try {
                        $cur = $ed.Current
                        if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
                        $nm = if ($cur.Name) { $cur.Name.Trim() } else { "" }
                        if ($nm -match '(?i)add\s+a\s+comment|comment') {
                            $ed.SetFocus()
                            Start-Sleep -Milliseconds 120
                            break
                        }
                    } catch { $null = $_ }
                }
            }
        } catch { $null = $_ }

        # Type the comment text using real hardware VK strokes
        $typedChars = [DesktopNative]::SendUnicodeLine($payloadText, 4, 20)
        Start-Sleep -Milliseconds 420

        # Read back composed comment text via UIA when supported to verify composition before approval/publish
        $composedVerified = ($typedChars -ge $payloadText.Length)
        try {
            $focusedEl = [System.Windows.Automation.AutomationElement]::FocusedElement
            if ($focusedEl) {
                $tpObj = $null
                $vpObj = $null
                $readBack = ""
                if ($focusedEl.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tpObj) -and $tpObj -and $tpObj.DocumentRange) {
                    $readBack = [string]$tpObj.DocumentRange.GetText(-1)
                } elseif ($focusedEl.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpObj) -and $vpObj) {
                    $readBack = [string]$vpObj.Current.Value
                }
                if (-not [string]::IsNullOrWhiteSpace($readBack)) {
                    $expectedCompact = ($payloadText -replace "\s+", "")
                    $readCompact = ($readBack -replace "\s+", "")
                    $composedVerified = $readCompact.Contains($expectedCompact)
                }
            }
        } catch { $null = $_ }

        # Mandatory approval gate: never publish comment without explicit user approval ($Approved -eq "true")
        if ($Approved -ne "true") {
            Write-JsonResult ([PSCustomObject]@{
                success = $true
                found = $true
                status = "AWAITING_APPROVAL"
                requiresApproval = $true
                composed = $true
                composedVerified = $composedVerified
                verified = $false
                action = "youtubecomment"
                title = $matchWin.Title
                comment = $payloadText
                typedChars = $typedChars
                boxX = $boxX
                boxY = $boxY
                message = "Composed comment '$payloadText' on YouTube. Awaiting explicit user approval before publishing."
            })
            break
        }

        # Click the "Comment" submit button via UIA if visible, and also send Ctrl+Enter
        $submitMethod = "ctrl_enter"
        $clickedSubmitBtn = $false
        try {
            $autoRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
            if ($autoRoot) {
                $btnCond = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Button
                )
                $btns = $autoRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
                foreach ($b in $btns) {
                    try {
                        $cur = $b.Current
                        if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
                        $nm = if ($cur.Name) { $cur.Name.Trim() } else { "" }
                        $br = $cur.BoundingRectangle
                        if ($nm -match '^(?i)comment$' -and $br.Top -ge ($boxY - 25) -and $br.Top -le ($boxY + 260)) {
                            $btnX = [int]($br.Left + ($br.Width / 2))
                            $btnY = [int]($br.Top + ($br.Height / 2))
                            [DesktopNative]::SetCursorPos($btnX, $btnY) | Out-Null
                            Start-Sleep -Milliseconds 35
                            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                            Start-Sleep -Milliseconds 25
                            [DesktopNative]::mouse_event([DesktopNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                            $clickedSubmitBtn = $true
                            $submitMethod = "uia_comment_button"
                            Start-Sleep -Milliseconds 250
                            break
                        }
                    } catch { $null = $_ }
                }
            }
        } catch { $null = $_ }

        if (-not $clickedSubmitBtn) {
            [DesktopNative]::SendCtrlEnter() | Out-Null
            Start-Sleep -Milliseconds 250
        }

        # Re-observe the live page after submission to verify the published comment appears in the thread
        Start-Sleep -Milliseconds 1100
        $publishedVerified = $false
        $snippet = $payloadText.Substring(0, [Math]::Min(24, $payloadText.Length)).ToLowerInvariant()
        try {
            $autoRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
            if ($autoRoot) {
                $txtCond = New-Object System.Windows.Automation.OrCondition(
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)),
                    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Group))
                )
                $nodes = $autoRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $txtCond)
                foreach ($nd in $nodes) {
                    try {
                        $cur = $nd.Current
                        if ($cur.IsOffscreen) { continue }
                        $nm = if ($cur.Name) { $cur.Name.Trim().ToLowerInvariant() } else { "" }
                        if ($nm.Contains($snippet) -and $cur.BoundingRectangle.Top -ge ($boxY - 15)) {
                            $publishedVerified = $true
                            break
                        }
                    } catch { $null = $_ }
                }
            }
        } catch { $null = $_ }

        $finalStatus = if ($publishedVerified) { "SUCCESS" } else { "PARTIAL_SUCCESS" }

        Write-JsonResult ([PSCustomObject]@{
            success = $true
            found = $true
            status = $finalStatus
            published = $true
            verified = $publishedVerified
            composedVerified = $composedVerified
            action = "youtubecomment"
            title = $matchWin.Title
            comment = $payloadText
            typedChars = $typedChars
            boxX = $boxX
            boxY = $boxY
            submitMethod = $submitMethod
        })
        break
    }
    "saveapp" {
        [DesktopNative]::EnsureDpiAware()
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

        if ([string]::IsNullOrWhiteSpace($FilePath)) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                status = "FAILED"
                action = "saveapp"
                error = "Target FilePath is required for saveapp"
            })
            break
        }

        $parentDir = [System.IO.Path]::GetDirectoryName($FilePath)
        if ([string]::IsNullOrWhiteSpace($parentDir) -or -not (Test-Path -LiteralPath $parentDir -PathType Container)) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                status = "FAILED"
                action = "saveapp"
                filePath = $FilePath
                error = "Target directory '$parentDir' does not exist"
            })
            break
        }

        if ((Test-Path -LiteralPath $FilePath -PathType Leaf) -and ($Overwrite -ne "true")) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                status = "AWAITING_APPROVAL"
                requiresApproval = $true
                existingFileProtected = $true
                action = "saveapp"
                filePath = $FilePath
                error = "File '$FilePath' already exists. Explicit overwrite approval is required to prevent data loss."
            })
            break
        }

        $expectedText = ""
        if (![string]::IsNullOrWhiteSpace($ExpectedTextBase64)) {
            $expectedText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExpectedTextBase64))
        }

        $targetHint = if ([string]::IsNullOrWhiteSpace($TargetWindow)) { "notepad" } else { $TargetWindow }
        $matchWin = Find-TargetWindow $targetHint ""
        if (-not $matchWin) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $false
                status = "FAILED"
                action = "saveapp"
                filePath = $FilePath
                error = "Window matching '$targetHint' not found"
            })
            break
        }

        $hwnd = $matchWin.Handle
        $targetPid = [uint32]0
        [DesktopNative]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
        if (-not (Ensure-WindowForeground $hwnd $targetPid)) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                status = "FAILED"
                action = "saveapp"
                title = $matchWin.Title
                filePath = $FilePath
                error = "Could not lock foreground focus onto '$($matchWin.Title)' before saving"
            })
            break
        }

        # Read active editor content via UIA before triggering Ctrl+S
        $preSaveEditorText = ""
        try {
            $el = [System.Windows.Automation.AutomationElement]::FocusedElement
            if ($el) {
                $tpObj = $null
                $vpObj = $null
                if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tpObj) -and $tpObj -and $tpObj.DocumentRange) {
                    $preSaveEditorText = [string]$tpObj.DocumentRange.GetText(-1)
                } elseif ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vpObj) -and $vpObj) {
                    $preSaveEditorText = [string]$vpObj.Current.Value
                }
            }
        } catch { $null = $_ }

        if ([string]::IsNullOrWhiteSpace($expectedText) -and -not [string]::IsNullOrWhiteSpace($preSaveEditorText)) {
            $expectedText = $preSaveEditorText
        }

        # Trigger Ctrl+S to open Save As dialog (or save in place)
        [DesktopNative]::SendCtrlShortcut('S') | Out-Null
        Start-Sleep -Milliseconds 600

        # Locate Save As dialog filename input box via UIA
        $enteredFileName = $false
        try {
            $fgDialog = [DesktopNative]::GetForegroundWindow()
            $dialogRoot = [System.Windows.Automation.AutomationElement]::FromHandle($fgDialog)
            if ($dialogRoot) {
                $editCond = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                )
                $edits = $dialogRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
                foreach ($ed in $edits) {
                    try {
                        $cur = $ed.Current
                        if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
                        $nm = if ($cur.Name) { $cur.Name.Trim() } else { "" }
                        if ($nm -match '(?i)file\s*name' -or $edits.Count -eq 1) {
                            $ed.SetFocus()
                            Start-Sleep -Milliseconds 80
                            [DesktopNative]::SendCtrlShortcut('A') | Out-Null
                            Start-Sleep -Milliseconds 40
                            $null = [DesktopNative]::SendUnicodeLine($FilePath, 3, 15)
                            Start-Sleep -Milliseconds 120
                            [DesktopNative]::SendVirtualKey([DesktopNative]::VK_RETURN) | Out-Null
                            $enteredFileName = $true
                            break
                        }
                    } catch { $null = $_ }
                }
            }
        } catch { $null = $_ }

        if (-not $enteredFileName) {
            [DesktopNative]::SendCtrlShortcut('A') | Out-Null
            Start-Sleep -Milliseconds 40
            $null = [DesktopNative]::SendUnicodeLine($FilePath, 3, 15)
            Start-Sleep -Milliseconds 120
            [DesktopNative]::SendVirtualKey([DesktopNative]::VK_RETURN) | Out-Null
        }

        Start-Sleep -Milliseconds 350
        # Handle potential Confirm Save As modal
        $confirmHwnd = [DesktopNative]::GetForegroundWindow()
        $confirmTitle = Get-WindowTitleSafe $confirmHwnd
        if ($confirmTitle -match '(?i)confirm\s+save') {
            if ($Overwrite -eq "true") {
                [DesktopNative]::SendVirtualKey([DesktopNative]::VK_RETURN) | Out-Null
            } else {
                [DesktopNative]::SendVirtualKey([DesktopNative]::VK_ESCAPE) | Out-Null
                Write-JsonResult ([PSCustomObject]@{
                    success = $false
                    status = "AWAITING_APPROVAL"
                    requiresApproval = $true
                    existingFileProtected = $true
                    action = "saveapp"
                    filePath = $FilePath
                    error = "Save As overwrite confirmation dialog detected; aborted because Overwrite is not approved."
                })
                break
            }
        }

        # Poll for file existence on disk and verify content
        $fileExists = $false
        for ($poll = 0; $poll -lt 8; $poll++) {
            if (Test-Path -LiteralPath $FilePath -PathType Leaf) {
                $fileExists = $true
                break
            }
            Start-Sleep -Milliseconds 180
        }

        if (-not $fileExists) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                status = "FAILED"
                verified = $false
                action = "saveapp"
                title = $matchWin.Title
                filePath = $FilePath
                error = "File '$FilePath' was not created on disk after save operation"
            })
            break
        }

        $diskContent = ""
        try {
            $diskContent = [System.IO.File]::ReadAllText($FilePath, [System.Text.Encoding]::UTF8)
        } catch { $null = $_ }

        $contentVerified = $true
        if (-not [string]::IsNullOrWhiteSpace($expectedText)) {
            $expCompact = ($expectedText -replace "\s+", "")
            $diskCompact = ($diskContent -replace "\s+", "")
            $contentVerified = ($expCompact.Length -eq 0) -or $diskCompact.Contains($expCompact)
        }

        if (-not $contentVerified) {
            Write-JsonResult ([PSCustomObject]@{
                success = $false
                found = $true
                status = "FAILED"
                verified = $false
                action = "saveapp"
                title = $matchWin.Title
                filePath = $FilePath
                savedBytes = $diskContent.Length
                error = "Saved file '$FilePath' content did not match expected document text"
            })
            break
        }

        Write-JsonResult ([PSCustomObject]@{
            success = $true
            found = $true
            status = "SUCCESS"
            verified = $true
            action = "saveapp"
            title = $matchWin.Title
            filePath = $FilePath
            savedBytes = $diskContent.Length
        })
        break
    }
    "worker" {
        [DesktopNative]::EnsureDpiAware()
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        Add-Type -AssemblyName System.Drawing

        while ($true) {
            $line = [Console]::In.ReadLine()
            if ($null -eq $line) { break }
            $trimmedLine = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmedLine)) { continue }

            $req = $null
            try {
                $req = $trimmedLine | ConvertFrom-Json
            } catch {
                $null = $_
                $errObj = [PSCustomObject]@{
                    id = $null
                    error = [PSCustomObject]@{
                        code = -32700
                        message = "Malformed JSON-RPC request"
                    }
                }
                $errB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($errObj | ConvertTo-Json -Depth 5 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $errB64 + "__END__")
                [Console]::Out.Flush()
                continue
            }

            $reqId = if ($null -ne $req.id) { [string]$req.id } else { "" }
            $act = if ($null -ne $req.action) { [string]$req.action } else { "" }

            if ([string]::IsNullOrWhiteSpace($act)) {
                $errObj = [PSCustomObject]@{
                    id = $reqId
                    error = [PSCustomObject]@{
                        code = -32600
                        message = "Invalid JSON-RPC request: missing 'action'"
                    }
                }
                $errB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($errObj | ConvertTo-Json -Depth 5 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $errB64 + "__END__")
                [Console]::Out.Flush()
                continue
            }

            $actLower = $act.ToLowerInvariant()
            if ($actLower -eq "ping" -or $actLower -eq "health") {
                $pongObj = [PSCustomObject]@{
                    id = $reqId
                    result = [PSCustomObject]@{
                        success = $true
                        action = "ping"
                        workerWarm = $true
                        pid = $PID
                    }
                }
                $pongB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($pongObj | ConvertTo-Json -Depth 5 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $pongB64 + "__END__")
                [Console]::Out.Flush()
                continue
            }

            if ($actLower -eq "shutdown") {
                $byeObj = [PSCustomObject]@{
                    id = $reqId
                    result = [PSCustomObject]@{
                        success = $true
                        action = "shutdown"
                        pid = $PID
                    }
                }
                $byeB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($byeObj | ConvertTo-Json -Depth 5 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $byeB64 + "__END__")
                [Console]::Out.Flush()
                break
            }

            if ($actLower -eq "sleep") {
                $sleepMs = if ($req.params -and $req.params.SleepMs) { [int]$req.params.SleepMs } else { 500 }
                Start-Sleep -Milliseconds $sleepMs
                $slpObj = [PSCustomObject]@{
                    id = $reqId
                    result = [PSCustomObject]@{
                        success = $true
                        action = "sleep"
                        sleptMs = $sleepMs
                    }
                }
                $slpB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($slpObj | ConvertTo-Json -Depth 5 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $slpB64 + "__END__")
                [Console]::Out.Flush()
                continue
            }

            try {
                $invokeParams = @{ Action = $act }
                if ($null -ne $req.params) {
                    foreach ($prop in $req.params.PSObject.Properties) {
                        if ($null -ne $prop.Value) {
                            $invokeParams[$prop.Name] = $prop.Value
                        }
                    }
                }
                $rawOut = (& $PSCommandPath @invokeParams) -join "`n"
                $resObj = $null
                if ($rawOut -match '__CREATER_B64__([\s\S]*?)__END__') {
                    $innerB64 = $Matches[1] -replace '\s+', ''
                    $innerJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($innerB64))
                    $resObj = $innerJson | ConvertFrom-Json
                } else {
                    $resObj = [PSCustomObject]@{
                        success = $false
                        action = $act
                        error = "No structured output returned from action '$act'"
                    }
                }
                $envObj = [PSCustomObject]@{
                    id = $reqId
                    result = $resObj
                }
                $envB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($envObj | ConvertTo-Json -Depth 6 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $envB64 + "__END__")
                [Console]::Out.Flush()
            } catch {
                $errMsg = $_.Exception.Message
                $errObj = [PSCustomObject]@{
                    id = $reqId
                    error = [PSCustomObject]@{
                        code = -32603
                        message = $errMsg
                    }
                }
                $errB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($errObj | ConvertTo-Json -Depth 5 -Compress)))
                [Console]::Out.WriteLine("__CREATER_RPC__" + $errB64 + "__END__")
                [Console]::Out.Flush()
            }
        }
        break
    }
    default {
        Write-JsonResult ([PSCustomObject]@{
            success = $false
            error = "Unknown action '$Action'"
        })
    }
}
