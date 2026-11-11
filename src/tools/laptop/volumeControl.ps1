param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("up", "down", "mute", "unmute", "get", "set")]
    [string]$Action,

    [Parameter(Mandatory=$false)]
    [float]$Value = 10.0
)

$ErrorActionPreference = "Stop"

$code = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
    int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}

public class MasterAudio {
    static IAudioEndpointVolume Vol() {
        var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
        IMMDevice dev = null;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
        IAudioEndpointVolume epv = null;
        var epvid = typeof(IAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
        return epv;
    }

    public static float GetVolume() {
        float v = 0;
        Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v));
        return (float)Math.Round(v * 100.0, 1);
    }

    public static float SetVolume(float percent) {
        float scalar = Math.Max(0.0f, Math.Min(100.0f, percent)) / 100.0f;
        Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(scalar, System.Guid.Empty));
        return (float)Math.Round(scalar * 100.0, 1);
    }

    public static float StepVolume(float deltaPercent) {
        float cur = GetVolume();
        float target = Math.Max(0.0f, Math.Min(100.0f, cur + deltaPercent));
        return SetVolume(target);
    }

    public static bool GetMute() {
        bool m = false;
        Marshal.ThrowExceptionForHR(Vol().GetMute(out m));
        return m;
    }

    public static bool SetMute(bool mute) {
        Marshal.ThrowExceptionForHR(Vol().SetMute(mute, System.Guid.Empty));
        return mute;
    }

    public static bool ToggleMute() {
        bool current = GetMute();
        return SetMute(!current);
    }
}
'@

try {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
} catch {
    # Type may already be added in current session
}

$vol = [MasterAudio]::GetVolume()
$muted = [MasterAudio]::GetMute()

switch ($Action) {
    "up" {
        $vol = [MasterAudio]::StepVolume($Value)
        # If unmuting when turning up
        if ($muted) {
            $muted = [MasterAudio]::SetMute($false)
        }
    }
    "down" {
        $vol = [MasterAudio]::StepVolume(-$Value)
    }
    "mute" {
        $muted = [MasterAudio]::SetMute($true)
    }
    "unmute" {
        $muted = [MasterAudio]::SetMute($false)
    }
    "set" {
        $vol = [MasterAudio]::SetVolume($Value)
    }
    "get" {
        # Just return current
    }
}

$result = [PSCustomObject]@{
    success = $true
    action = $Action
    volume = [math]::Round($vol)
    muted = $muted
}

$result | ConvertTo-Json -Compress

