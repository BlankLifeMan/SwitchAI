import { useEffect, useState } from "react";
import { useConfigStore } from "../store/configStore";
import { useToastStore } from "../store/toastStore";
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
import type { Provider, ModelRouting } from "../types";

function SortableModelRow({
  id,
  modelName,
  idx,
}: {
  id: string;
  modelName: string;
  idx: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

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
          : "bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-gray-500 w-6 font-mono">{idx + 1}.</span>
      <span className="flex-1 font-mono text-gray-900 dark:text-white">{modelName}</span>
    </div>
  );
}

function SortableProviderCard({
  providerId,
  providerName,
  priority,
  isExpanded,
  onToggleExpand,
  children,
}: {
  providerId: string;
  providerName: string;
  priority: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `provider:${providerId}` });
  const { t } = useI18n();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card relative group transition-all duration-200 pl-10 pr-4 py-4 ${
        isDragging ? "opacity-50 ring-2 ring-primary-500 shadow-xl z-20 bg-white dark:bg-gray-800 animate-pulse" : ""
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-3 top-5 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-gray-900 dark:text-white text-base">{providerName}</span>
            <span className="ml-3 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full font-mono">
              Priority: {priority}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
          >
            {isExpanded 
              ? (t("models.collapseRouting") || "收起配置") 
              : (t("models.configureRouting") || "配置路由")}
          </button>
        </div>

        {isExpanded && (
          <div className="mt-3 pl-1 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export function Models() {
  const { t, lang } = useI18n();
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const addToast = useToastStore((s) => s.addToast);

  const [providersList, setProvidersList] = useState<Provider[]>([]);
  const [providerOrder, setProviderOrder] = useState<string[]>([]);
  const [mappings, setMappings] = useState<[string, string][]>([]);
  const [modelRoutings, setModelRoutings] = useState<ModelRouting[]>([]);
  
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  
  const [newRouteModel, setNewRouteModel] = useState("");
  const [newRouteStrategy, setNewRouteStrategy] = useState<"failover" | "loadbalance" | "lowest_latency" | "lowest_cost">("failover");
  const [dirty, setDirty] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (config) {
      // Sort providers by priority descending initially
      const sorted = [...(config.providers || [])].sort((a, b) => b.priority - a.priority);
      setProvidersList(JSON.parse(JSON.stringify(sorted)));
      setProviderOrder(sorted.map((p) => p.id));
      setMappings(Object.entries(config.model_mappings || {}));
      // Add default wildcard failover rule if no routing rules exist
      const existingRules = config.routing?.models || [];
      if (existingRules.length === 0) {
        setModelRoutings([{ model: "*", strategy: "failover", provider_order: [] }]);
        setDirty(true);
      } else {
        setModelRoutings(existingRules);
      }
    }
  }, [config]);

  const handleGlobalDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    if (activeIdStr.startsWith("provider:") && overIdStr.startsWith("provider:")) {
      const activePid = activeIdStr.replace("provider:", "");
      const overPid = overIdStr.replace("provider:", "");

      const oldIndex = providerOrder.indexOf(activePid);
      const newIndex = providerOrder.indexOf(overPid);
      if (oldIndex !== -1 && newIndex !== -1) {
        setProviderOrder((prev) => arrayMove(prev, oldIndex, newIndex));
        setDirty(true);
      }
    } else if (activeIdStr.startsWith("model:") && overIdStr.startsWith("model:")) {
      const partsActive = activeIdStr.split(":");
      const partsOver = overIdStr.split(":");
      if (partsActive.length === 3 && partsOver.length === 3) {
        const providerId = partsActive[1];
        const activeModel = partsActive[2];
        const overModel = partsOver[2];

        if (providerId === partsOver[1]) {
          setProvidersList((prev) =>
            prev.map((p) => {
              if (p.id !== providerId) return p;
              const oldIndex = p.models.indexOf(activeModel);
              const newIndex = p.models.indexOf(overModel);
              if (oldIndex === -1 || newIndex === -1) return p;
              const newModels = arrayMove(p.models, oldIndex, newIndex);
              return { ...p, models: newModels };
            })
          );
          setDirty(true);
        }
      }
    }
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

  const handleAddRouting = () => {
    const model = newRouteModel.trim();
    if (!model) return;

    if (modelRoutings.some((r) => r.model === model)) {
      addToast("error", lang === "zh" ? "该模型的策略规则已存在" : "Routing rule for this model already exists");
      return;
    }

    const newRule: ModelRouting = {
      model,
      strategy: newRouteStrategy,
      provider_order: [],
    };

    setModelRoutings((prev) => [...prev, newRule]);
    setNewRouteModel("");
    setDirty(true);
  };

  const handleDeleteRouting = (model: string) => {
    setModelRoutings((prev) => prev.filter((r) => r.model !== model));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!config) return;
    try {
      // Re-assign priorities to providers based on providerOrder
      const finalProviders = providersList.map((p) => {
        const idx = providerOrder.indexOf(p.id);
        return {
          ...p,
          priority: idx === -1 ? p.priority : (providerOrder.length - idx) * 10,
        };
      });

      // Sort by the new priority
      finalProviders.sort((a, b) => b.priority - a.priority);

      await saveConfig({
        ...config,
        providers: finalProviders,
        model_mappings: Object.fromEntries(mappings),
        routing: {
          models: modelRoutings,
        },
      });
      setDirty(false);
      addToast("success", t("toast.routingSaved"));
    } catch (e) {
      addToast("error", t("toast.routingSaveFailed"));
    }
  };

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

      {providerOrder.length === 0 && (
        <div className="card text-center text-gray-400 py-12">
          {lang === "zh" ? "暂无可用提供商，请先添加提供商。" : "No providers available. Please add providers first."}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGlobalDragEnd}
      >
        <SortableContext
          items={providerOrder.map((pid) => `provider:${pid}`)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid gap-4">
            {providerOrder.map((pid) => {
              const provider = providersList.find((p) => p.id === pid);
              if (!provider) return null;

              const isExpanded = expandedProviderId === pid;

              return (
                <SortableProviderCard
                  key={pid}
                  providerId={pid}
                  providerName={provider.name}
                  priority={provider.priority}
                  isExpanded={isExpanded}
                  onToggleExpand={() => setExpandedProviderId(isExpanded ? null : pid)}
                >
                  <SortableContext
                    items={provider.models.map((model) => `model:${pid}:${model}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1.5 mt-2">
                      <div className="text-xs text-gray-400 mb-2">
                        {lang === "zh"
                          ? "提示：拖动下方模型调整它们的匹配与路由重写优先级顺序（第 1 个将作为网关统一重写的主模型）。"
                          : "Tip: Drag models to change their matching and rewrite priorities (the 1st will be preferred in Unified Mode)."}
                      </div>
                      {provider.models.map((model, idx) => (
                        <SortableModelRow
                          key={model}
                          id={`model:${pid}:${model}`}
                          modelName={model}
                          idx={idx}
                        />
                      ))}
                      {provider.models.length === 0 && (
                        <p className="text-sm text-gray-400 px-3 py-1">
                          {lang === "zh" ? "该提供商没有配置支持的模型。" : "No models configured for this provider."}
                        </p>
                      )}
                    </div>
                  </SortableContext>
                </SortableProviderCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

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
                    <span className="font-mono bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-400 px-2 py-1 rounded border border-primary-100 dark:border-primary-900/50">
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

      {/* Model Routing Rules Section */}
      <div className="border-t border-gray-200 dark:border-gray-800 pt-6 mt-8 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {lang === "zh" ? "模型路由策略规则" : "Model Routing Strategy Rules"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {lang === "zh"
              ? "为特定模型或通配符规则（如 gpt-*）配置专属的转发重试与路由分发策略。"
              : "Configure dedicated proxying, retry, and distribution strategies for specific model IDs or wildcard patterns."}
          </p>
        </div>

        <div className="card space-y-4">
          {modelRoutings.length === 0 ? (
            <div className="text-center text-gray-400 py-6 text-sm">
              {lang === "zh" ? "暂无专属路由策略规则，全部模型使用默认故障转移策略。" : "No custom routing rules. All models will fallback to the default Failover strategy."}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {modelRoutings.map((rule) => (
                <div key={rule.model} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-mono bg-gray-100 dark:bg-gray-850 px-2 py-1 rounded text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-800">
                      {rule.model}
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      rule.strategy === "lowest_latency"
                        ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300"
                        : rule.strategy === "lowest_cost"
                          ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                          : rule.strategy === "loadbalance"
                            ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                            : "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300"
                    }`}>
                      {rule.strategy === "lowest_latency"
                        ? (lang === "zh" ? "最低延迟" : "Lowest Latency")
                        : rule.strategy === "lowest_cost"
                          ? (lang === "zh" ? "最低计费" : "Lowest Cost")
                          : rule.strategy === "loadbalance"
                            ? (lang === "zh" ? "负载均衡" : "Load Balance")
                            : (lang === "zh" ? "故障转移" : "Failover")}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteRouting(rule.model)}
                    className="text-red-500 hover:text-red-600 p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded text-sm transition-colors"
                    title={lang === "zh" ? "删除策略" : "Delete Rule"}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Routing Rule Row */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <div className="flex-1">
              <input
                type="text"
                placeholder={lang === "zh" ? "模型标识 (支持通配符，如: gpt-*, *)" : "Model pattern (wildcards supported, e.g. gpt-*, *)"}
                value={newRouteModel}
                onChange={(e) => setNewRouteModel(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div className="w-60">
              <select
                value={newRouteStrategy}
                onChange={(e) => setNewRouteStrategy(e.target.value as any)}
                className="w-full text-sm border border-gray-300 dark:border-gray-650 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="failover">{lang === "zh" ? "故障转移 (Failover)" : "Failover"}</option>
                <option value="loadbalance">{lang === "zh" ? "负载均衡 (Load Balance)" : "Load Balance"}</option>
                <option value="lowest_latency">{lang === "zh" ? "最低延迟 (Lowest Latency)" : "Lowest Latency"}</option>
                <option value="lowest_cost">{lang === "zh" ? "最低计费 (Lowest Cost)" : "Lowest Cost"}</option>
              </select>
            </div>
            <button
              onClick={handleAddRouting}
              className="btn-primary flex items-center justify-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === "zh" ? "添加规则" : "Add Rule"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
