import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

type Direction = Parameters<typeof appWindow.startResizeDragging>[0];

// Tailwind needs static, literal class strings (no interpolation) to pick these up.
const handles: { direction: Direction; className: string }[] = [
  { direction: "North", className: "left-0 right-0 top-0 h-[5px] cursor-ns-resize" },
  { direction: "South", className: "left-0 right-0 bottom-0 h-[5px] cursor-ns-resize" },
  { direction: "West", className: "left-0 top-0 bottom-0 w-[5px] cursor-ew-resize" },
  { direction: "East", className: "right-0 top-0 bottom-0 w-[5px] cursor-ew-resize" },
  { direction: "NorthWest", className: "left-0 top-0 h-[10px] w-[10px] cursor-nwse-resize" },
  { direction: "NorthEast", className: "right-0 top-0 h-[10px] w-[10px] cursor-nesw-resize" },
  { direction: "SouthWest", className: "left-0 bottom-0 h-[10px] w-[10px] cursor-nesw-resize" },
  { direction: "SouthEast", className: "right-0 bottom-0 h-[10px] w-[10px] cursor-nwse-resize" },
];

export function ResizeHandles() {
  return (
    <>
      {handles.map((h) => (
        <div
          key={h.direction}
          onMouseDown={(e) => {
            e.preventDefault();
            appWindow.startResizeDragging(h.direction);
          }}
          className={`fixed z-[100] ${h.className}`}
        />
      ))}
    </>
  );
}
