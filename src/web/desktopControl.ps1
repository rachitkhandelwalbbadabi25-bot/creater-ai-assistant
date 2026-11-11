# ════════════════════════════════════════════════════════════════════════════════
# src/tools/laptop/desktopControl.ps1 — Windows Desktop Native CUA Input Helper
# Provides fast, native mouse movements, clicks, window focus, and keystrokes.
# ════════════════════════════════════════════════════════════════════════════════

param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    [int]$X = 0,
    [int]$Y = 0,
    [string]$Button = "left",
    [string]$Text = "",
    [string]$Key = "",
    [string]$TargetWindow = ""
)

$ErrorActionPreference = "Stop"

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

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

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
}
"@ -IgnoreWarnings

Add-Type -AssemblyName System.Windows.Forms

switch ($Action.ToLower()) {
    "move" {
        [DesktopNative]::SetCursorPos($X, $Y) | Out-Null
        $pt = New-Object DesktopNative+POINT
        [DesktopNative]::GetCursorPos([ref]$pt) | Out-Null
        [PSCustomObject]@{
            success = $true
            action = "move"
            x = $pt.X
            y = $pt.Y
        } | ConvertTo-Json -Compress
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
        [PSCustomObject]@{
            success = $true
            action = "click"
            button = $Button
            x = $X
            y = $Y
        } | ConvertTo-Json -Compress
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
                    # Non-interactive session fallback
                }
            }
        }
        [PSCustomObject]@{
            success = $true
            action = "type"
            textLength = $Text.Length
        } | ConvertTo-Json -Compress
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
                    # Non-interactive session fallback
                }
            }
        }
        [PSCustomObject]@{
            success = $true
            action = "key"
            key = $Key
        } | ConvertTo-Json -Compress
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
            } catch {}
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
        } catch {}

        [PSCustomObject]@{
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
        } | ConvertTo-Json -Compress
        break
    }
    "focuswindow" {
        $found = $null
        if ($TargetWindow -match '^\d+$') {
            $targetPid = [int]$TargetWindow
            $found = Get-Process -Id $targetPid -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        } else {
            $found = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TargetWindow*" } | Select-Object -First 1
        }

        if ($found) {
            $hwnd = $found.MainWindowHandle
            [DesktopNative]::ShowWindow($hwnd, 9) | Out-Null # SW_RESTORE
            [DesktopNative]::SetForegroundWindow($hwnd) | Out-Null
            [PSCustomObject]@{
                success = $true
                found = $true
                pid = $found.Id
                title = $found.MainWindowTitle
            } | ConvertTo-Json -Compress
        } else {
            [PSCustomObject]@{
                success = $false
                found = $false
                message = "Window matching '$TargetWindow' not found"
            } | ConvertTo-Json -Compress
        }
        break
    }
    default {
        [PSCustomObject]@{
            success = $false
            error = "Unknown action '$Action'"
        } | ConvertTo-Json -Compress
    }
}
