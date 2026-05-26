import { useEffect, useState, useCallback } from "react";
import { useConfigStore } from "../store/configStore";
import { useToastStore } from "../store/toastStore";
import type { ModelRouting } from "../types";
import { GripVertical, Save, Plus, Trash2, ArrowRight } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Provider } from "../types";

function SortableProviderRow({
  pid,
  idx,
  providerName,
}: {
  pid: string;
  idx: number;
  providerName: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pid });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
        isDragging
          ? "bg-primary-50 dark:bg-primary-950 shadow-lg z-10"
          : "bg-gray-50 dark:bg-gray-900"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-4 h-4 text-gray-400" />
      </button>
      <span className="text-gray-500 w-6">{idx + 1}.</span>
      <span className="flex-1 text-gray-900 dark:text-white">{providerName}</span>
    </div>
  );
}

export function Models() {
  const { t } = useI18n();
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const addToast = useToastStore((s) => s.addToast);
  const [routing, setRouting] = useState<ModelRouting[]>([]);
  const [mappings, setMappings] = useState<[string, string][]>([]);
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [dirty, setDirty] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (config) {
      setRouting(JSON.parse(JSON.stringify(config.routing.models)));
      setMappings(Object.entries(config.model_mappings || {}));
    }
  }, [config]);

  const allModels = getAvailableModels(config?.providers || []);

  const getProvidersForModel = useCallback(
    (model: string): Provider[] => {
      return (
        config?.providers.filter((p) => p.models.includes(model)) || []
      );
    },
    [config]
  );

  const ensureModelRouting = useCallback(
    (model: string) => {
      const existing = routing.find((r) => r.model === model);
      if (!existing) {
        const providers = getProvidersForModel(model)
          .sort((a, b) => b.priority - a.priority)
          .map((p) => p.id);
        setRouting((prev) => [
          ...prev,
          { model, strategy: "failover" as const, provider_order: providers },
        ]);
        setDirty(true);
      }
    },
    [routing, config]
  );

  const updateStrategy = (model: string, strategy: "failover" | "loadbalance") => {
    setRouting((prev) =>
      prev.map((r) => (r.model === model ? { ...r, strategy } : r))
    );
    setDirty(true);
  };

  const handleDragEnd = (event: DragEndEvent, model: string) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setRouting((prev) =>
      prev.map((r) => {
        if (r.model !== model) return r;
        const oldIndex = r.provider_order.indexOf(String(active.id));
        const newIndex = r.provider_order.indexOf(String(over.id));
        if (oldIndex === -1 || newIndex === -1) return r;
        const newOrder = arrayMove(r.provider_order, oldIndex, newIndex);
        return { ...r, provider_order: newOrder };
      })
    );
    setDirty(true);
  };

  const handleAddMapping = () => {
    const src = newSource.trim();
    const dest = newTarget.trim();
    if (!src || !dest) return;

    if (mappings.some(([s]) => s === src)) {
      addToast("error", t("models.mappingExists") || "Mapping already exists");
      return;
    }

    setMappings((prev) => [...prev, [src, dest]]);
    setNewSource("");
    setNewTarget("");
    setDirty(true);
  };

  const handleDeleteMapping = (src: string) => {
    setMappings((prev) => prev.filter(([s]) => s !== src));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!config) return;
    try {
      await saveConfig({
        ...config,
        routing: { models: routing },
        model_mappings: Object.fromEntries(mappings),
      });
      setDirty(false);
      addToast("success", t("toast.routingSaved"));
    } catch (e) {
      addToast("error", t("toast.routingSaveFailed"));
    }
  };

  const getProviderName = (id: string) =>
    config?.providers.find((p) => p.id === id)?.name || id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("models.title")}</h1>
        {dirty && (
          <button onClick={handleSave} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" /> {t("models.saveChanges")}
          </button>
        )}
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">{t("models.desc")}</p>

      {allModels.length === 0 && (
        <div className="card text-center text-gray-400 py-12">{t("models.noModels")}</div>
      )}

      <div className="grid gap-4">
        {allModels.map((model) => {
          const route = routing.find((r) => r.model === model);
          const isConfigured = !!route;

          if (!isConfigured) {
            return (
              <div key={model} className="card flex items-center justify-between">
                <span className="font-medium text-gray-900 dark:text-white">{model}</span>
                <button
                  onClick={() => ensureModelRouting(model)}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  {t("models.configureRouting")}
                </button>
              </div>
            );
          }

          return (
            <div key={model} className="card space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900 dark:text-white">{model}</span>
                <div className="flex items-center gap-2">
                  <select
                    value={route.strategy}
                    onChange={(e) =>
                      updateStrategy(model, e.target.value as "failover" | "loadbalance")
                    }
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                  >
                    <option value="failover">{t("models.failover")}</option>
                    <option value="loadbalance">{t("models.loadBalance")}</option>
                  </select>
                </div>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleDragEnd(e, model)}
              >
                <SortableContext
                  items={route.provider_order}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {route.provider_order.map((pid, idx) => (
                      <SortableProviderRow
                        key={pid}
                        pid={pid}
                        idx={idx}
                        providerName={getProviderName(pid)}
                      />
                    ))}
                    {route.provider_order.length === 0 && (
                      <p className="text-sm text-gray-400 px-3">{t("models.noProvider")}</p>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          );
        })}
      </div>

      {/* Model Mappings Section */}
      <div className="border-t border-gray-200 dark:border-gray-800 pt-6 mt-8 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {t("models.mappings")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("models.mappingsDesc")}
          </p>
        </div>

        <div className="card space-y-4">
          {mappings.length === 0 ? (
            <div className="text-center text-gray-400 py-6 text-sm">
              {t("models.noMappings")}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {mappings.map(([src, dest]) => (
                <div key={src} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-mono bg-gray-100 dark:bg-gray-850 px-2 py-1 rounded text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-800">
                      {src}
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                    <span className="font-mono bg-primary-50 dark:bg-primary-950 px-2 py-1 rounded text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800">
                      {dest}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteMapping(src)}
                    className="text-red-500 hover:text-red-600 p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded text-sm transition-colors"
                    title={t("models.deleteMapping")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Mapping Row */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <div className="flex-1">
              <input
                type="text"
                placeholder={t("models.sourceModel")}
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div className="flex items-center justify-center hidden sm:flex">
              <ArrowRight className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex-1">
              <input
                type="text"
                placeholder={t("models.targetModel")}
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <button
              onClick={handleAddMapping}
              className="btn-primary flex items-center justify-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{t("models.addMapping")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getAvailableModels(providers: { models: string[] }[]): string[] {
  const set = new Set<string>();
  for (const p of providers) {
    for (const m of p.models) {
      set.add(m);
    }
  }
  return Array.from(set).sort();
}
