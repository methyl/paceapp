import { useState } from "react";
import FileUpload from "./components/FileUpload";
import Summary from "./components/Summary";
import LapTable from "./components/LapTable";
import DynamicsCharts from "./components/DynamicsCharts";
import { parseFitFile } from "./parseFit";
import type { ParsedActivity } from "./types";

function App() {
  const [activity, setActivity] = useState<ParsedActivity | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const handleFile = async (buffer: ArrayBuffer, name: string) => {
    setLoading(true);
    setError("");
    try {
      const parsed = await parseFitFile(buffer);
      setActivity(parsed);
      setFileName(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse FIT file");
      setActivity(null);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setActivity(null);
    setFileName("");
    setError("");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            PaceApp
            <span className="text-sm font-normal text-gray-500 ml-2">Running Dynamics Analyzer</span>
          </h1>
          {activity && (
            <button
              onClick={handleReset}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Load another file
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {!activity && !loading && (
          <div className="max-w-lg mx-auto mt-12">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                Analyze Your Run
              </h2>
              <p className="text-gray-600">
                Upload a .FIT file from your Garmin or other device to see detailed
                running dynamics per segment.
              </p>
            </div>
            <FileUpload onFileLoaded={handleFile} />
          </div>
        )}

        {loading && (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600 mt-3">Parsing FIT file...</p>
          </div>
        )}

        {error && (
          <div className="max-w-lg mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              <p className="font-medium">Error parsing file</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
            <div className="mt-4">
              <FileUpload onFileLoaded={handleFile} />
            </div>
          </div>
        )}

        {activity && (
          <>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>File: {fileName}</span>
            </div>
            <Summary summary={activity.summary} />
            <LapTable laps={activity.laps} />
            <DynamicsCharts laps={activity.laps} records={activity.records} />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
