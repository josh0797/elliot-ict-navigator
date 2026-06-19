import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  previewDataset,
  trainModel,
  listModelVersions,
  setActiveModel,
  checkAdmin,
} from "@/lib/training.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Brain, Upload, Sparkles, CheckCircle2, Loader2, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/training")({
  head: () => ({ meta: [{ title: "Training — Elliott × ICT Pro" }] }),
  component: TrainingPage,
});

type Preview = { total: number; wins: number; losses: number; usable: number; skipped: number };
type Metrics = {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  trainSize: number;
  valSize: number;
  positives: number;
  negatives: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
};
type Importance = { name: string; weight: number };
type Version = {
  id: string;
  version: number;
  trained_on: number;
  accuracy: number | null;
  metrics: Metrics | Record<string, never>;
  is_active: boolean;
  created_at: string;
};

function TrainingPage() {
  const isAdminFn = useServerFn(checkAdmin);
  const previewFn = useServerFn(previewDataset);
  const trainFn = useServerFn(trainModel);
  const listFn = useServerFn(listModelVersions);
  const activateFn = useServerFn(setActiveModel);

  const [admin, setAdmin] = useState<boolean | null>(null);
  const [csv, setCsv] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [training, setTraining] = useState(false);
  const [lastMetrics, setLastMetrics] = useState<Metrics | null>(null);
  const [importances, setImportances] = useState<Importance[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isAdminFn().then((r) => setAdmin(r.isAdmin)).catch(() => setAdmin(false));
  }, [isAdminFn]);

  async function refreshVersions() {
    try {
      const v = (await listFn()) as Version[];
      setVersions(v);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (admin) refreshVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  async function onFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("CSV too large (max 20 MB)");
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    setPreview(null);
    setLastMetrics(null);
    setImportances([]);
    try {
      const p = await previewFn({ data: { csv: text } });
      setPreview(p);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onTrain() {
    if (!csv) return;
    setTraining(true);
    try {
      const res = await trainFn({ data: { csv } });
      setLastMetrics(res.metrics);
      setImportances(res.importances);
      toast.success(`Trained v${res.version} · acc ${(res.metrics.accuracy * 100).toFixed(1)}%`);
      await refreshVersions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTraining(false);
    }
  }

  async function onActivate(id: string) {
    try {
      await activateFn({ data: { id } });
      toast.success("Model activated");
      await refreshVersions();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (admin === null)
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking permissions…
      </div>
    );

  if (!admin)
    return (
      <div className="p-6 max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4" /> Admin only
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This area trains and manages the proprietary scoring model. Only administrators can access it.
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" /> Model training
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload your historical Elliott × ICT dataset, train a logistic-regression scorer, and activate it for live alerts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" /> 1 · Upload dataset
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) await onFile(f);
            }}
            onClick={() => fileInput.current?.click()}
            className="border border-dashed border-border/70 rounded-md p-6 text-center cursor-pointer hover:border-primary/50"
          >
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onFile(f);
              }}
            />
            <div className="text-sm">
              {filename ? (
                <span className="text-foreground font-mono">{filename}</span>
              ) : (
                <>
                  <span className="text-foreground">Drop your CSV here</span>{" "}
                  <span className="text-muted-foreground">or click to browse</span>
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Required columns include: instrument, timeframe, direction, pattern, wave_current, wave_degree, result.
            </div>
          </div>

          {preview && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <Stat label="Rows" value={preview.total} />
              <Stat label="Wins" value={preview.wins} cls="text-success" />
              <Stat label="Losses" value={preview.losses} cls="text-destructive" />
              <Stat label="Usable" value={preview.usable} />
              <Stat label="Skipped" value={preview.skipped} cls="text-muted-foreground" />
            </div>
          )}

          <Button onClick={onTrain} disabled={!csv || training} className="w-full sm:w-auto">
            {training ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {training ? "Training…" : "Train model"}
          </Button>
        </CardContent>
      </Card>

      {lastMetrics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · Validation metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <Stat label="Accuracy" value={`${(lastMetrics.accuracy * 100).toFixed(1)}%`} cls="text-primary" />
              <Stat label="Precision" value={`${(lastMetrics.precision * 100).toFixed(1)}%`} />
              <Stat label="Recall" value={`${(lastMetrics.recall * 100).toFixed(1)}%`} />
              <Stat label="F1" value={`${(lastMetrics.f1 * 100).toFixed(1)}%`} />
              <Stat label="Val size" value={lastMetrics.valSize} />
            </div>
            <div className="grid grid-cols-4 gap-3 text-xs font-mono">
              <Stat label="TP" value={lastMetrics.confusion.tp} cls="text-success" />
              <Stat label="FP" value={lastMetrics.confusion.fp} cls="text-destructive" />
              <Stat label="TN" value={lastMetrics.confusion.tn} cls="text-success" />
              <Stat label="FN" value={lastMetrics.confusion.fn} cls="text-destructive" />
            </div>

            {importances.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Top features</div>
                <div className="space-y-1">
                  {importances.map((f) => (
                    <div key={f.name} className="flex items-center gap-2 text-xs font-mono">
                      <span className="w-48 truncate">{f.name}</span>
                      <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                        <div
                          className={f.weight >= 0 ? "bg-success h-full" : "bg-destructive h-full"}
                          style={{ width: `${Math.min(100, Math.abs(f.weight) * 50)}%` }}
                        />
                      </div>
                      <span className={f.weight >= 0 ? "text-success" : "text-destructive"}>
                        {f.weight.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3 · Model versions</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No models trained yet.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-3 gap-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-mono">v{v.version}</span>
                    {v.is_active && (
                      <Badge className="bg-success/15 text-success border-success/30" variant="outline">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-muted-foreground">samples {v.trained_on}</span>
                    <span className="text-primary">acc {((v.accuracy ?? 0) * 100).toFixed(1)}%</span>
                    {!v.is_active && (
                      <Button size="sm" variant="outline" onClick={() => onActivate(v.id)}>
                        Activate
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string | number; cls?: string }) {
  return (
    <div className="border border-border/60 rounded-md p-3 bg-card/40">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-mono ${cls ?? ""}`}>{value}</div>
    </div>
  );
}