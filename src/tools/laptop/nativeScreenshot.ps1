param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class NativeScreenCapture {
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    const int SM_CXSCREEN = 0;
    const int SM_CYSCREEN = 1;
    const int SRCCOPY = 0x00CC0020;

    public static bool Capture(string filePath) {
        int width = GetSystemMetrics(SM_CXSCREEN);
        int height = GetSystemMetrics(SM_CYSCREEN);

        IntPtr hWnd = GetDesktopWindow();
        IntPtr hSrcDC = GetWindowDC(hWnd);
        IntPtr hDestDC = CreateCompatibleDC(hSrcDC);
        IntPtr hBitmap = CreateCompatibleBitmap(hSrcDC, width, height);
        IntPtr hOldBitmap = SelectObject(hDestDC, hBitmap);

        bool success = BitBlt(hDestDC, 0, 0, width, height, hSrcDC, 0, 0, SRCCOPY);

        if (success) {
            using (Bitmap bmp = Image.FromHbitmap(hBitmap)) {
                bmp.Save(filePath, ImageFormat.Png);
            }
        }

        SelectObject(hDestDC, hOldBitmap);
        DeleteObject(hBitmap);
        DeleteDC(hDestDC);
        ReleaseDC(hWnd, hSrcDC);

        return success;
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies "System.Drawing.dll"
$res = [NativeScreenCapture]::Capture($OutputPath)
if ($res) {
    Write-Output "Screenshot saved successfully to $OutputPath"
} else {
    Write-Error "BitBlt failed"
}

