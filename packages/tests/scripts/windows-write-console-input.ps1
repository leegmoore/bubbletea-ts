param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('key', 'mouse')]
    [string]$RecordType,
    [Parameter(Mandatory = $true)]
    [int]$Handle,
    [Parameter(Mandatory = $true)]
    [string]$Payload
)

$decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
$payload = $decoded | ConvertFrom-Json

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct Coord
{
    public short X;
    public short Y;
}

[StructLayout(LayoutKind.Sequential)]
public struct KeyEventRecord
{
    [MarshalAs(UnmanagedType.Bool)]
    public bool KeyDown;
    public ushort RepeatCount;
    public ushort VirtualKeyCode;
    public ushort VirtualScanCode;
    public ushort UnicodeChar;
    public uint ControlKeyState;
}

[StructLayout(LayoutKind.Sequential)]
public struct MouseEventRecord
{
    public Coord MousePosition;
    public uint ButtonState;
    public uint ControlKeyState;
    public uint EventFlags;
}

[StructLayout(LayoutKind.Explicit)]
public struct InputEvent
{
    [FieldOffset(0)]
    public KeyEventRecord KeyEvent;

    [FieldOffset(0)]
    public MouseEventRecord MouseEvent;
}

[StructLayout(LayoutKind.Sequential)]
public struct InputRecord
{
    public ushort EventType;
    public InputEvent Event;
}

public static class ConsoleInputInjector
{
    private const ushort KEY_EVENT = 0x0001;
    private const ushort MOUSE_EVENT = 0x0002;

    [DllImport("msvcrt.dll", SetLastError = true)]
    private static extern IntPtr _get_osfhandle(int fd);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteConsoleInputW(IntPtr hConsoleInput, InputRecord[] records, uint count, out uint written);

    private static IntPtr ResolveHandle(int fd)
    {
        var handle = _get_osfhandle(fd);
        if (handle == new IntPtr(-1))
        {
            throw new InvalidOperationException("_get_osfhandle returned INVALID_HANDLE_VALUE");
        }
        return handle;
    }

    private static void WriteRecord(int fd, InputRecord record)
    {
        var handle = ResolveHandle(fd);
        if (!WriteConsoleInputW(handle, new[] { record }, 1, out var written) || written != 1)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "WriteConsoleInputW failed");
        }
    }

    public static void WriteKeyEvent(int fd, bool keyDown, ushort repeatCount, ushort virtualKeyCode, ushort virtualScanCode, ushort unicodeChar, uint controlKeyState)
    {
        var record = new InputRecord
        {
            EventType = KEY_EVENT,
            Event = new InputEvent
            {
                KeyEvent = new KeyEventRecord
                {
                    KeyDown = keyDown,
                    RepeatCount = repeatCount,
                    VirtualKeyCode = virtualKeyCode,
                    VirtualScanCode = virtualScanCode,
                    UnicodeChar = unicodeChar,
                    ControlKeyState = controlKeyState
                }
            }
        };
        WriteRecord(fd, record);
    }

    public static void WriteMouseEvent(int fd, short x, short y, uint buttonState, uint controlKeyState, uint eventFlags)
    {
        var record = new InputRecord
        {
            EventType = MOUSE_EVENT,
            Event = new InputEvent
            {
                MouseEvent = new MouseEventRecord
                {
                    MousePosition = new Coord { X = x, Y = y },
                    ButtonState = buttonState,
                    ControlKeyState = controlKeyState,
                    EventFlags = eventFlags
                }
            }
        };
        WriteRecord(fd, record);
    }
}
"@

try {
    switch ($RecordType) {
        'key' {
            [ConsoleInputInjector]::WriteKeyEvent(
                $Handle,
                [bool]$payload.keyDown,
                [UInt16]$payload.repeatCount,
                [UInt16]$payload.virtualKeyCode,
                [UInt16]$payload.virtualScanCode,
                [UInt16]$payload.charCode,
                [UInt32]$payload.controlKeyState
            ) | Out-Null
        }
        'mouse' {
            [ConsoleInputInjector]::WriteMouseEvent(
                $Handle,
                [Int16]$payload.x,
                [Int16]$payload.y,
                [UInt32]$payload.buttonState,
                [UInt32]$payload.controlKeyState,
                [UInt32]$payload.eventFlags
            ) | Out-Null
        }
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
