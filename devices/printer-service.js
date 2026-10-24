(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MizaqPrinterService = api;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  "use strict";

  const SETTINGS_KEY = "mizaq_devices_v1";
  const MODES = ["simulation", "electron", "browser", "qztray"];
  const DRAWER_ADAPTERS = ["simulation", "disabled", "qz-raw", "electron-vendor"];
  const MAX_LOGS = 100;

  const defaults = () => ({
    mode: "simulation",
    kitchenPrinter: "",
    cashierPrinter: "",
    drawerAdapter: "simulation",
    drawerPrinter: "",
    drawerRawHex: "",
    drawerEvents: []
  });

  const documents = typeof module === "object" && module.exports
    ? require("./print-documents.js")
    : root.MizaqPrintDocuments;

  function createService(options) {
    options = options || {};
    const storage = options.storage || (typeof localStorage === "object" ? localStorage : null);
    const bridge = options.bridge || null;
    const getQz = options.getQz || (() => typeof window !== "undefined" ? window.qz : null);
    const now = options.now || (() => new Date().toISOString());
    const onChange = options.onChange || (() => {});
    let config = defaults();
    let logs = [];
    let lastError = "";
    let qzLoadPromise = null;

    async function requireQz() {
      const available = getQz();
      if (available) return available;
      if (typeof document === "undefined") throw new Error("QZ Tray ومكتبته المحلية غير متاحين.");
      if (!qzLoadPromise) {
        qzLoadPromise = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "./vendor/qz-tray.js";
          script.onload = () => {
            const qz = getQz();
            if (qz) resolve(qz);
            else reject(new Error("لم تُنشئ مكتبة QZ Tray المحلية الواجهة المتوقعة."));
          };
          script.onerror = () => {
            qzLoadPromise = null;
            reject(new Error("مكتبة QZ Tray غير موجودة محلياً في vendor/qz-tray.js."));
          };
          document.head.appendChild(script);
        });
      }
      return qzLoadPromise;
    }

    function publish() {
      onChange(getState());
    }

    function load() {
      if (storage) {
        try {
          const saved = JSON.parse(storage.getItem(SETTINGS_KEY) || "null");
          if (saved && typeof saved === "object" && !Array.isArray(saved)) {
            const initial = defaults();
            config = {
              ...initial,
              ...saved,
              mode: MODES.includes(saved.mode) ? saved.mode : initial.mode,
              drawerAdapter: DRAWER_ADAPTERS.includes(saved.drawerAdapter) ? saved.drawerAdapter : initial.drawerAdapter,
              drawerEvents: Array.isArray(saved.drawerEvents)
                ? saved.drawerEvents.filter((id) => typeof id === "string")
                : []
            };
          }
        } catch (error) {
          lastError = `تعذر قراءة إعدادات الأجهزة: ${error.message}`;
        }
      }
      return getSettings();
    }

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(SETTINGS_KEY, JSON.stringify(config));
      } catch (error) {
        lastError = `تعذر حفظ إعدادات الأجهزة: ${error.message}`;
        throw error;
      }
    }

    function getSettings() {
      return { ...config, drawerEvents: config.drawerEvents.slice() };
    }

    function getState() {
      return {
        mode: config.mode,
        simulated: config.mode === "simulation",
        electronAvailable: !!(bridge && typeof bridge.listPrinters === "function"),
        qzAvailable: !!getQz(),
        lastError,
        logs: logs.slice()
      };
    }

    function record(action, status, details) {
      const entry = { id: `${now()}-${logs.length + 1}`, time: now(), action, status, details: details || "" };
      logs.unshift(entry);
      logs = logs.slice(0, MAX_LOGS);
      if (status === "error") lastError = details || "حدث خطأ غير محدد في الجهاز.";
      else if (status === "success" || status === "simulated") lastError = "";
      publish();
      return entry;
    }

    function updateSettings(patch) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("إعدادات الأجهزة غير صالحة.");
      }
      const allowed = ["mode", "kitchenPrinter", "cashierPrinter", "drawerAdapter", "drawerPrinter", "drawerRawHex"];
      const next = { ...config };
      allowed.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
      });
      if (!MODES.includes(next.mode)) throw new TypeError("وضع الطباعة غير معروف.");
      if (!DRAWER_ADAPTERS.includes(next.drawerAdapter)) throw new TypeError("Adapter درج النقود غير معروف.");
      ["kitchenPrinter", "cashierPrinter", "drawerPrinter"].forEach((key) => {
        if (typeof next[key] !== "string" || next[key].length > 256) throw new TypeError(`اسم الجهاز غير صالح: ${key}`);
      });
      if (typeof next.drawerRawHex !== "string" || next.drawerRawHex.length > 512 || (next.drawerRawHex && !/^(?:[0-9a-fA-F]{2})(?:\s+[0-9a-fA-F]{2})*$/.test(next.drawerRawHex))) {
        throw new TypeError("أمر الدرج يجب أن يكون بايتات Hex مفصولة بمسافات، وبحسب تعليمات الشركة المصنّعة فقط.");
      }
      const previous = config;
      config = { ...next, drawerEvents: config.drawerEvents.slice() };
      try {
        persist();
      } catch (error) {
        config = previous;
        publish();
        throw error;
      }
      lastError = "";
      publish();
      return getSettings();
    }

    async function listPrinters() {
      try {
        if (config.mode === "simulation") {
          const printers = [
            { name: "MIZAQ Simulated Kitchen Printer", displayName: "محاكاة: طابعة المطبخ", status: "simulated" },
            { name: "MIZAQ Simulated Cashier Printer", displayName: "محاكاة: طابعة الكاشير", status: "simulated" }
          ];
          record("اكتشاف الطابعات", "simulated", "طابعات افتراضية؛ لا يوجد اتصال بجهاز فعلي.");
          return printers;
        }
        if (config.mode === "electron") {
          if (!bridge || typeof bridge.listPrinters !== "function") throw new Error("جسر Electron غير متاح في هذه الصفحة.");
          const printers = await bridge.listPrinters();
          if (!Array.isArray(printers)) throw new Error("أعاد Electron قائمة طابعات غير صالحة.");
          record("اكتشاف الطابعات", "success", `عُثر على ${printers.length} طابعة نظام.`);
          return printers;
        }
        if (config.mode === "qztray") {
          const qz = await requireQz();
          if (!qz || !qz.websocket) throw new Error("QZ Tray غير مثبت محلياً أو لم تُحمّل مكتبته.");
          if (!qz.websocket.isActive()) await qz.websocket.connect();
          const names = await qz.printers.find();
          if (!Array.isArray(names)) throw new Error("أعاد QZ Tray قائمة طابعات غير صالحة.");
          record("اكتشاف الطابعات", "success", `عُثر على ${names.length} طابعة عبر QZ Tray.`);
          return names.map((name) => ({ name, displayName: name, status: "available" }));
        }
        record("اكتشاف الطابعات", "success", "يعرض المتصفح نافذة اختيار الطابعة عند الطباعة.");
        return [];
      } catch (error) {
        record("اكتشاف الطابعات", "error", error.message);
        throw error;
      }
    }

    async function print(kind, ticket, target) {
      if (!["kitchen", "receipt", "test"].includes(kind)) throw new TypeError("نوع مستند الطباعة غير معروف.");
      const printerName = (target || kind) === "kitchen" ? config.kitchenPrinter : config.cashierPrinter;
      const html = documents.buildDocument(kind, ticket);
      try {
        if (config.mode === "simulation") {
          record(kind === "kitchen" ? "طباعة تذكرة المطبخ" : kind === "test" ? "اختبار الطباعة" : "طباعة فاتورة العميل", "simulated", "أمر محاكاة فقط؛ لم تتم الطباعة على جهاز فعلي.");
          return { simulated: true, html };
        }
        if (config.mode === "electron") {
          if (!bridge || typeof bridge.printDocument !== "function") throw new Error("جسر Electron غير متاح؛ لم تتم الطباعة.");
          if (!printerName) throw new Error("اختر طابعة فعلية لهذا النوع من المستندات أولاً.");
          const result = await bridge.printDocument({ kind, printerName, ticket: ticket || {} });
          record(kind === "kitchen" ? "طباعة تذكرة المطبخ" : kind === "test" ? "اختبار الطباعة" : "طباعة فاتورة العميل", "success", `أُرسل إلى ${printerName}.`);
          return result;
        }
        if (config.mode === "qztray") {
          const qz = await requireQz();
          if (!qz || !qz.websocket || !qz.printers || !qz.configs || !qz.print) throw new Error("QZ Tray ومكتبته المحلية غير متاحين.");
          if (!printerName) throw new Error("اختر طابعة QZ Tray لهذا النوع من المستندات أولاً.");
          if (!qz.websocket.isActive()) await qz.websocket.connect();
          const printerConfig = qz.configs.create(printerName, { encoding: "UTF-8" });
          await qz.print(printerConfig, [{ type: "html", format: "plain", data: html }]);
          record(kind === "kitchen" ? "طباعة تذكرة المطبخ" : kind === "test" ? "اختبار الطباعة" : "طباعة فاتورة العميل", "success", `أُرسل عبر QZ Tray إلى ${printerName}.`);
          return { simulated: false };
        }
        const popup = typeof window !== "undefined" ? window.open("", "_blank") : null;
        if (!popup) throw new Error("تعذر فتح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة ثم أعد المحاولة.");
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
        let printStarted = false;
        const startPrinting = () => {
          if (printStarted) return;
          printStarted = true;
          popup.focus();
          popup.print();
        };
        popup.addEventListener("load", startPrinting, { once: true });
        setTimeout(startPrinting, 300);
        record(kind === "kitchen" ? "طباعة تذكرة المطبخ" : kind === "test" ? "اختبار الطباعة" : "طباعة فاتورة العميل", "success", "فُتحت نافذة اختيار طابعة المتصفح.");
        return { simulated: false };
      } catch (error) {
        record(kind === "kitchen" ? "طباعة تذكرة المطبخ" : kind === "test" ? "اختبار الطباعة" : "طباعة فاتورة العميل", "error", error.message);
        throw error;
      }
    }

    async function printKitchenTicket(ticket) {
      return print("kitchen", ticket);
    }

    async function printCustomerReceipt(ticket) {
      return print("receipt", ticket);
    }

    async function testPrint(target) {
      if (target !== "kitchen" && target !== "cashier") throw new TypeError("حدد الطابعة المراد اختبارها.");
      return print("test", { orderId: "TEST", id: "TEST", table: "معاينة", waiterName: "—", lines: [{ productName: "اختبار الطباعة", qty: 1 }] }, target);
    }

    async function openCashDrawer(event) {
      const item = event || {};
      const paymentId = typeof item.paymentId === "string" ? item.paymentId : "";
      if (!paymentId) throw new TypeError("معرّف عملية الدفع مطلوب لفتح الدرج.");
      if (item.paymentStatus !== "paid") {
        record("فتح درج النقود", "error", "رُفض فتح الدرج: لم تُؤكد عملية الدفع.");
        throw new Error("لا يُفتح الدرج قبل نجاح الدفع.");
      }
      if (config.drawerEvents.includes(paymentId)) {
        record("فتح درج النقود", "skipped", "تمت معالجة حدث عملية الدفع هذه سابقاً.");
        return { alreadyProcessed: true };
      }
      try {
        config.drawerEvents = [...config.drawerEvents, paymentId];
        persist();
        if (config.drawerAdapter === "disabled") {
          record("فتح درج النقود", "skipped", "Adapter الدرج معطّل.");
          return { skipped: true };
        }
        if (config.mode === "simulation" || config.drawerAdapter === "simulation") {
          record("فتح درج النقود", "simulated", "محاكاة فقط؛ لم يُرسل أي أمر إلى درج أو طابعة فعلية.");
          return { simulated: true };
        }
        if (config.drawerAdapter === "qz-raw") {
          const qz = await requireQz();
          if (config.mode !== "qztray" || !qz || !qz.websocket || !qz.configs || !qz.print) throw new Error("يلزم اختيار QZ Tray ووجود مكتبته المحلية قبل استخدام Adapter الدرج.");
          if (!config.drawerPrinter || !config.drawerRawHex) throw new Error("حدد طابعة الدرج وأمر الشركة المصنّعة الموثق بصيغة Hex أولاً.");
          if (!qz.websocket.isActive()) await qz.websocket.connect();
          const printerConfig = qz.configs.create(config.drawerPrinter);
          await qz.print(printerConfig, [{ type: "raw", format: "hex", data: config.drawerRawHex.replace(/\s+/g, "") }]);
          record("فتح درج النقود", "success", `أُرسل أمر الشركة المصنّعة إلى ${config.drawerPrinter}.`);
          return { simulated: false };
        }
        if (bridge && typeof bridge.openCashDrawer === "function") {
          const result = await bridge.openCashDrawer({ paymentId });
          record("فتح درج النقود", "success", "استجاب Adapter الدرج.");
          return result;
        }
        throw new Error("Electron لا يوفّر بروتوكولاً عاماً لدرج USB؛ يلزم Adapter الشركة المصنّعة الموثق.");
      } catch (error) {
        record("فتح درج النقود", "error", error.message);
        throw error;
      }
    }

    function preview(kind, ticket) {
      return documents.buildDocument(kind, ticket);
    }

    function clearLogs() {
      logs = [];
      publish();
    }

    load();
    return {
      settings: getSettings,
      state: getState,
      load,
      updateSettings,
      listPrinters,
      printKitchenTicket,
      printCustomerReceipt,
      testPrint,
      openCashDrawer,
      preview,
      clearLogs
    };
  }

  return { SETTINGS_KEY, createService };
});
