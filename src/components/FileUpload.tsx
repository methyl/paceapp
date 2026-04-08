import { useCallback, useState } from "react";

interface FileUploadProps {
  onFilesLoaded: (files: { buffer: ArrayBuffer; name: string }[]) => void;
  multiple?: boolean;
}

async function collectFitFiles(
  dirHandle: FileSystemDirectoryHandle
): Promise<{ buffer: ArrayBuffer; name: string }[]> {
  const results: { buffer: ArrayBuffer; name: string }[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".fit")) {
      const file = await entry.getFile();
      const buffer = await file.arrayBuffer();
      results.push({ buffer, name: entry.name });
    } else if (entry.kind === "directory") {
      const sub = await collectFitFiles(entry);
      results.push(...sub);
    }
  }

  return results;
}

export default function FileUpload({ onFilesLoaded, multiple = false }: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);

  const handleFiles = useCallback(
    (files: FileList) => {
      const fitFiles = Array.from(files).filter((f) =>
        f.name.toLowerCase().endsWith(".fit")
      );
      if (fitFiles.length === 0) {
        alert("No .FIT files found");
        return;
      }
      const promises = fitFiles.map(
        (f) =>
          new Promise<{ buffer: ArrayBuffer; name: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ buffer: reader.result as ArrayBuffer, name: f.name });
            reader.readAsArrayBuffer(f);
          })
      );
      Promise.all(promises).then(onFilesLoaded);
    },
    [onFilesLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const handleDirectoryPick = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      alert(
        "Directory picker is not supported in this browser. Use Chrome or Edge."
      );
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker!({ mode: "read" });
      setScanning(true);
      const files = await collectFitFiles(dirHandle);
      setScanning(false);
      if (files.length === 0) {
        alert("No .FIT files found in the selected folder");
        return;
      }
      onFilesLoaded(files);
    } catch (err) {
      setScanning(false);
      if ((err as DOMException).name !== "AbortError") {
        alert("Failed to read directory");
      }
    }
  }, [onFilesLoaded]);

  if (scanning) {
    return (
      <div className="border-2 border-dashed rounded-xl p-12 text-center border-blue-300 bg-blue-50">
        <div className="inline-block w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-blue-700 font-medium">
          Scanning folder for .FIT files...
        </p>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-50"
          : "border-gray-300 hover:border-gray-400 bg-gray-50"
      }`}
    >
      <input
        type="file"
        accept=".fit"
        multiple={multiple}
        onChange={handleInputChange}
        className="hidden"
        id="fit-upload"
      />
      <div className="text-4xl mb-3">📂</div>
      <p className="text-lg font-medium text-gray-700">
        Drop .FIT file{multiple ? "s" : ""} here
      </p>
      <p className="text-sm text-gray-500 mt-1 mb-4">or</p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <label
          htmlFor="fit-upload"
          className="inline-block px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
        >
          Browse files
        </label>
        {"showDirectoryPicker" in window && (
          <button
            onClick={handleDirectoryPick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Open folder (iCloud, etc.)
          </button>
        )}
      </div>
    </div>
  );
}
