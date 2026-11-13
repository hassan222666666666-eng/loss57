import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Accept large image payloads from camera
  app.use(express.json({ limit: '40mb' }));

  // Initialize Gemini Client
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  // ----------------- STAGE 2: GEMINI VISION API ENDPOINT -----------------
  app.post('/api/analyze-shelf', async (req, res) => {
    try {
      const {
        photoDataUrl,
        goldenPhotoDataUrl,
        shelfId,
        shelfContext,
        recentCorrections,
        knownShelves,
        fastMode = false,
        singleShelfFocusMode = true,
      } = req.body;

      if (!photoDataUrl || typeof photoDataUrl !== 'string') {
        return res.status(400).json({ error: 'Missing photoDataUrl' });
      }

      // Extract base64 and mime type
      const match = photoDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid data URL format' });
      }
      const mimeType = match[1];
      const base64Data = match[2];

      // Prepare context strings
      const aisle = shelfContext?.aisle || 'غير محدد';
      const shelfNum = shelfContext?.shelfNumber || '1';
      const knownCapacity = shelfContext?.knownCapacity || null;
      const knownProducts = Array.isArray(shelfContext?.knownProducts) ? shelfContext.knownProducts : [];
      const corrections = Array.isArray(recentCorrections) ? recentCorrections : [];
      // In fastMode when shelfId is already matched and has known products, skip sending 15 unrelated shelves
      const shelvesList =
        fastMode && shelfId && knownProducts.length > 0
          ? []
          : Array.isArray(knownShelves)
          ? knownShelves
          : [];

      let correctionsPrompt = '';
      if (corrections.length > 0) {
        correctionsPrompt = `
سجل تصحيحات وتدريبات سابقة للمشرف على هذا الرف (Few-Shot Corrections):
${corrections
  .slice(0, 3)
  .map(
    (c, i) =>
      `${i + 1}. المنتج: "${c.productName}" - كان التقدير السابق ${c.previousMissing} قطعة، وصححه المشرف إلى ${c.correctedMissing} قطعة ناقصة.`
  )
  .join('\n')}
يرجى استخدام هذه التعديلات كمرجع لتعلم النمط وتحسين دقة التقدير.
`;
      }

      let productsContextPrompt = '';
      if (knownProducts.length > 0) {
        productsContextPrompt = `المنتجات المعروفة المسجلة لهذا الرف سابقاً: ${knownProducts.join('، ')}. يرجى استخدام نفس التسميات العربية القياسية (standardized_name) إذا كانت المنتجات مطابقة لتوحيد الإحصائيات.`;
      }

      let knownShelvesPrompt = '';
      if (shelvesList.length > 0) {
        knownShelvesPrompt = `
قائمة الأرفف المسجلة مسبقاً في المتجر (لمطابقة shelf_match_id إن تطابقت المنتجات أو الرف):
${shelvesList
  .slice(0, 15)
  .map(
    (s: { id: string; name: string; fullCapacity?: number | null; productNames?: string[] }) =>
      `- المعرف: "${s.id}" | الاسم: "${s.name}" | السعة: ${s.fullCapacity ?? 'غير محددة'} | المنتجات: ${
        Array.isArray(s.productNames) && s.productNames.length > 0 ? s.productNames.join('، ') : 'غير مسجلة'
      }`
  )
  .join('\n')}
إذا تطابقت الصورة مع أحد هذه الأرفف، أرجع معرفه في shelf_match_id، وإلا أرجع ${shelfId ? `"${shelfId}"` : 'null'}.
`;
      }

      const singleShelfRules = singleShelfFocusMode
        ? `
قاعدة التركيز التلقائي على رف واحد فقط (إلزامي 100%):
- إذا ظهرت في الصورة عدة أرفف أفقية فوق بعضها (علوي، أوسط، سفلي) أو أرفف جانبية مجاورة، يجب عليك اختيار وعزل **رف أفقي رئيسي واحد فقط** (الأقرب لمركز الصورة والأكثر وضوحاً واكتمالاً).
- حدد أولاً focused_shelf_label (مثل: "الرف الأوسط") وإحداثيات الرف الواحد المختار في focused_shelf_box بصيغة [ymin, xmin, ymax, xmax] من 0 إلى 1000.
- ممنوع منعاً باتاً إدراج أي منتج من الرف العلوي أو الرف السفلي أو الرفوف الجانبية خارج حدود focused_shelf_box! اقتصر في مصفوفة products على منتجات هذا الرف الواحد فقط.`
        : '';

      const visualRules = `
قواعد الحساب البصري الصارمة (ممنوع التخمين الوهمي):
1. حدد أولاً خط الحافة الأمامية للرف (حيث تقف العبوات الملاصقة لمقدمة الرف).
2. أي منتج عبوته الأمامية متقدمة وملاصقة لخط الحافة الأمامية للرف مثل جيرانه ولا توجد أمامه مساحة فارغة مكشوفة على أرضية الرف ← يجب أن يكون missing_units = 0 حتماً! لا تفترض أو تخمّن أبداً وجود نقص مخفي خلف العبوة الأمامية ما لم تُرفق صورة مرجعية تثبت ذلك.
3. يُحسب النقص (missing_units > 0) فقط إذا كان هناك فراغ مرئي واضح:
   - إما صف متراجع للخلف (تظهر أرضية الرف الفارغة أمام العبوة المتبقية مقارنة بالعبوات المجاورة المتقدمة على الحافة الأمامية): احسب عدد العبوات التي تسعها هذه المسافة الفارغة أمامها لتصل إلى نفس مستوى العبوات المجاورة المتقدمة (مثلاً عبوتان = 2).
   - أو خانة فارغة تماماً بالعرض.
4. قارن مسافة التراجع بترتيب وعمق العبوات المصطفة في الصف المجاور مباشرةً (مثلاً: إذا ظهرت 3 عبوات متراصة من الأمام للخلف في الصف المجاور، والمنتج المتراجع يقف بمحاذاة العبوة الثالثة، فالنقص أمامه = 2).`;

      const systemInstruction = fastMode
        ? `أنت مدقق أرفف سوبرماركت دقيق جداً.\n${singleShelfRules}\n${visualRules}\nأعد أسماء المنتجات داخل الرف الواحد المختار فقط مع missing_units = 0 للصفوف المتقدمة للحافة الأمامية، والعدد الدقيق فقط للصفوف المتراجعة أو الفارغة.`
        : `
أنت خبير فحص وجرد وتوثيق أرفف المتاجر والسوبرماركت (Supermarket Shelf Restock Auditor).
${singleShelfRules}
${visualRules}

مهمتك فحص صورة الرف الحالية لتحديد:
1. معرف الرف المطابق (shelf_match_id) من قائمة الأرفف المعروفة أو السياق، أو null إذا كان رفاً جديداً غير مطابق.
2. عزل رف أفقي واحد فقط في focused_shelf_label و focused_shelf_box عند تفعيل التركيز على رف واحد.
3. المنتجات الموجودة في ذلك الرف الواحد فقط وأسماؤها العربية القياسية (standardized_name) بحيث تكون واضحة ومتسقة مع الأسماء المعروفة مسبقاً.
4. عدد الوحدات الظاهرة بوضوح (units_present).
5. عدد الوحدات الناقصة (missing_units) — ويجب أن يكون 0 لأي صف عبوته الأمامية ملاصقة للحافة الأمامية للرف بدون فراغ أمامي ظاهر.
6. نسبة الثقة في التحليل (confidence بين 0.0 و 1.0).
7. الإحداثيات المستطيلة لموقع المنتج أو الفراغ (bounding_box بصيغة [ymin, xmin, ymax, xmax] أرقام صحيحة مقيسة من 0 إلى 1000).

إذا أُرفقت صورة مرجعية ثانية (Golden Reference للرف الممتلئ)، فقارن بدقة بالغة بين الصورتين جنباً إلى جنب لتحديد مقدار الفراغ والقطع الناقصة بالمقارنة مع حالة الرف المكتمل.
      `;

      if (ai) {
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // 1. Current Shelf Photo
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });

        // 2. Golden Reference Photo (if available)
        if (goldenPhotoDataUrl && typeof goldenPhotoDataUrl === 'string') {
          const goldMatch = goldenPhotoDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (goldMatch) {
            parts.push({
              inlineData: {
                mimeType: goldMatch[1],
                data: goldMatch[2],
              },
            });
          }
        }

        // Concise prompt instructions for lowest latency + strict single-shelf & alignment check
        const promptText = `
افحص الصورة${singleShelfFocusMode ? ' وعزّل رفاً أفقياً واحداً رئيسياً فقط (الأوسط/الأوضح)' : ''} واحسب النواقص بدقة بصرية دون تخمين.
الرف: الممر "${aisle}" - رقم "${shelfNum}"${shelfId ? ` - المعرف "${shelfId}"` : ''}.
${knownCapacity ? `السعة الكلية المعروفة للرف: ${knownCapacity} وحدة.` : ''}
${productsContextPrompt}
${knownShelvesPrompt}
${correctionsPrompt}
${
  goldenPhotoDataUrl
    ? 'الصورة 1: الرف الحالي. الصورة 2: المرجع الممتلئ (Golden Reference). قارن بينهما لحساب missing_units بدقة.'
    : 'تحقق من الحافة الأمامية لكل منتج داخل الرف المختار فقط: أي منتج يقف عند حافة الرف الأمامية مثل جيرانه نقصه 0. احسب missing_units > 0 فقط للمنتج المتراجع للخلف بقياس عدد العبوات الناقصة أمامه مقارنة بتقدم الصفوف المجاورة.'
}
أرجع JSON مطابق للمخطط فقط.
`;
        parts.push({ text: promptText });

        const PRIMARY_MODEL = 'gemini-4-hydrogen';
        const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

        const productProperties: Record<string, unknown> = {
          standardized_name: {
            type: Type.STRING,
            description: 'الاسم العربي القياسي للمنتج',
          },
          is_recessed_from_front: {
            type: Type.BOOLEAN,
            description: 'true فقط إذا كانت العبوة متراجعة للخلف وتظهر أرضية الرف الفارغة أمامها مقارنة بجيرانها المتقدمين عند الحافة الأمامية، وfalse إذا كانت عند الحافة الأمامية',
          },
          units_present: {
            type: Type.INTEGER,
            description: 'عدد العبوات المرئية حالياً في هذا الصف',
          },
          missing_units: {
            type: Type.INTEGER,
            description: 'إذا كان is_recessed_from_front=false فيجب أن يكون 0. وإذا كان true فاحسب كم عبوة تسعها المسافة الفارغة أمامها حتى الحافة الأمامية',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'نسبة الثقة من 0.0 إلى 1.0',
          },
          bounding_box: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: 'إحداثيات موقع هذا المنتج أو الفراغ [ymin, xmin, ymax, xmax] أرقام صحيحة بين 0 و 1000',
          },
        };

        const requiredFields = [
          'standardized_name',
          'is_recessed_from_front',
          'units_present',
          'missing_units',
          'confidence',
          'bounding_box',
        ];

        const rootProperties: Record<string, unknown> = {
          shelf_match_id: {
            type: Type.STRING,
            nullable: true,
            description: 'معرف الرف المطابق من السياق إن وُجد، أو null',
          },
        };
        const rootRequired = ['shelf_match_id'];
        if (singleShelfFocusMode) {
          rootProperties.focused_shelf_label = {
            type: Type.STRING,
            description: 'تسمية الرف الأفقي الواحد الذي تم عزله للتحليل مثل: الرف الأوسط',
          };
          rootProperties.focused_shelf_box = {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: 'إحداثيات مستطيل الرف الواحد المختار [ymin, xmin, ymax, xmax] من 0 إلى 1000',
          };
          rootRequired.push('focused_shelf_label', 'focused_shelf_box');
        }
        rootProperties.products = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: productProperties,
            required: requiredFields,
          },
        };
        rootRequired.push('products');

        const runVisionCall = async (modelName: string, timeoutMs: number) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const isLite = modelName === 'gemini-3.1-flash-lite';
            return await ai!.models.generateContent({
              model: modelName,
              contents: { parts },
              config: {
                abortSignal: controller.signal,
                systemInstruction,
                thinkingConfig: {
                  thinkingLevel: isLite ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
                },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: rootProperties,
                  required: rootRequired,
                },
              },
            });
          } finally {
            clearTimeout(timer);
          }
        };

        // Call Gemini Vision with generous timeout + graceful retry on transient errors (429/503) or 404 fallback
        let responseText = '{}';
        const maxAttempts = 2;
        let activeModel = PRIMARY_MODEL;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const response = await runVisionCall(activeModel, 35000);
            responseText = response.text || '{}';
            break;
          } catch (apiErr: unknown) {
            const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
            const isNotFound = msg.includes('404') || msg.includes('NOT_FOUND');
            if (isNotFound && activeModel !== FALLBACK_MODEL) {
              activeModel = FALLBACK_MODEL;
              continue;
            }
            const isTransient = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('503');
            if (isTransient && attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 1200));
              continue;
            }
            throw apiErr;
          }
        }

        const cleanedJson = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim() || '{}';
        const parsed = JSON.parse(cleanedJson);

        const rawMatchId = parsed.shelf_match_id;
        const normalizedMatchId =
          typeof rawMatchId === 'string' && rawMatchId.trim() !== '' && rawMatchId.trim().toLowerCase() !== 'null'
            ? rawMatchId.trim()
            : shelfId || null;

        let focusedShelfBox: [number, number, number, number] | undefined = undefined;
        if (Array.isArray(parsed.focused_shelf_box) && parsed.focused_shelf_box.length === 4) {
          const fy1 = Math.max(0, Math.min(1000, Math.round(Number(parsed.focused_shelf_box[0]) || 0)));
          const fx1 = Math.max(0, Math.min(1000, Math.round(Number(parsed.focused_shelf_box[1]) || 0)));
          const fy2 = Math.max(0, Math.min(1000, Math.round(Number(parsed.focused_shelf_box[2]) || 1000)));
          const fx2 = Math.max(0, Math.min(1000, Math.round(Number(parsed.focused_shelf_box[3]) || 1000)));
          if (fy2 > fy1 && fx2 > fx1) {
            focusedShelfBox = [fy1, fx1, fy2, fx2];
          }
        }
        const focusedShelfLabel =
          typeof parsed.focused_shelf_label === 'string' && parsed.focused_shelf_label.trim()
            ? parsed.focused_shelf_label.trim()
            : singleShelfFocusMode
            ? 'الرف الرئيسي المختار'
            : undefined;

        const defaultBox: [number, number, number, number] = focusedShelfBox || [100, 100, 900, 900];
        const normalizedProducts = Array.isArray(parsed.products)
          ? parsed.products.map((p: Record<string, unknown>) => {
              const rawBox = Array.isArray(p.bounding_box) ? p.bounding_box : defaultBox;
              const clampedBox: [number, number, number, number] = [
                Math.max(0, Math.min(1000, Math.round(Number(rawBox[0]) || 0))),
                Math.max(0, Math.min(1000, Math.round(Number(rawBox[1]) || 0))),
                Math.max(0, Math.min(1000, Math.round(Number(rawBox[2]) || 1000))),
                Math.max(0, Math.min(1000, Math.round(Number(rawBox[3]) || 1000))),
              ];
              return {
                standardized_name: String(p.standardized_name || 'منتج غير محدد').trim(),
                units_present: Math.max(0, Math.round(Number(p.units_present) || 0)),
                missing_units: Math.max(0, Math.round(Number(p.missing_units) || 0)),
                confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0.5)),
                bounding_box: clampedBox,
              };
            })
          : [];

        return res.json({
          shelf_match_id: normalizedMatchId,
          focused_shelf_label: focusedShelfLabel,
          focused_shelf_box: focusedShelfBox,
          products: normalizedProducts,
          rawResponse: responseText,
          analyzedAt: Date.now(),
        });
      } else {
        // Graceful Simulated Analysis when GEMINI_API_KEY is not set yet
        console.warn('[Gemini Vision] GEMINI_API_KEY not found in environment, returning realistic simulated analysis');

        // Create realistic products based on aisle context
        const sampleProductsMap: Record<string, string[]> = {
          'المنظفات والورقيات': ['سائل جلي C4 أخضر 1 لتر', 'مسحوق غسيل تايد 2.5 كغ', 'مناديل كلينكس كلاسيك'],
          'الألبان والأجبان': ['حليب المراعي كامل الدسم 1 لتر', 'لبنة المراعي طازجة 400 غ', 'جبنة فيتا بوك 500 غ'],
          'الزيوت والمؤن': ['زيت عافية ذرة 1.5 لتر', 'سكر الأسرة ناعم 5 كغ', 'أرز الشعلان بسمتي 10 كغ'],
          'المعلبات': ['تونة قودي ماء وملح 160 غ', 'حمص حب حدائق كاليفورنيا', 'فول مدمس لونا 400 غ'],
          'المشروبات والعصائر': ['عصير راني برتقال حبيبات 240 مل', 'مياه نقي كرتون 40 قارورة', 'شاي لبتون أحمر 100 خيط'],
        };

        const defaultList = sampleProductsMap[aisle] || [
          knownProducts[0] || 'سائل جلي C4 أخضر 1 لتر',
          knownProducts[1] || 'مناديل ورقية فاخرة 200 حبة',
        ];

        const simulatedProducts = defaultList.slice(0, 2).map((name, idx) => {
          const cap = knownCapacity ? Math.round(knownCapacity / defaultList.length) : 12;
          const present = Math.max(1, Math.round(cap * 0.35));
          const missing = Math.max(1, cap - present);
          const yOffset = idx * 450 + 80;
          return {
            standardized_name: name,
            units_present: present,
            missing_units: missing,
            confidence: idx === 0 ? 0.88 : 0.65, // idx 1 triggers < 0.7 review test!
            bounding_box: [yOffset, 120, yOffset + 380, 880] as [number, number, number, number],
          };
        });

        return res.json({
          shelf_match_id: shelfId || null,
          focused_shelf_label: singleShelfFocusMode ? 'الرف الأوسط' : undefined,
          focused_shelf_box: singleShelfFocusMode ? [220, 80, 740, 920] : undefined,
          products: simulatedProducts,
          rawResponse: 'SIMULATED_GEMINI_ANALYSIS',
          analyzedAt: Date.now(),
        });
      }
    } catch (err: unknown) {
      console.error('Gemini shelf analysis error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && (err.name === 'AbortError' || errMsg.includes('aborted'));
      return res.status(isAbort ? 504 : 500).json({
        error: isAbort ? 'انتهت مهلة الاتصال بخدمة التحليل' : 'Failed to analyze shelf photo',
        details: errMsg,
      });
    }
  });

  // Ensure /api/* routes always return JSON (never fall through to HTML SPA or Express HTML error pages)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
      const message = err instanceof Error ? err.message : 'Unexpected server error';
      return res.status(status).json({ error: message });
    }
    return next(err);
  });

  // ----------------- VITE MIDDLEWARE / STATIC FILES -----------------
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // Prevent @vite/client from opening an unreachable WebSocket or throwing SendBeforeConnectError when HMR is disabled
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const patched = result.code.replace(
          'transport.connect(createHMRHandler(handleMessage));',
          '/* HMR WebSocket disabled */\ntransport.connect = async () => {};\ntransport.disconnect = async () => {};\ntransport.send = async () => {};'
        );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        if (result.etag) res.setHeader('ETag', result.etag);
        return res.send(patched);
      } catch {
        return next();
      }
    });

    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Rofoof Server] Ready at http://0.0.0.0:${PORT}`);
  });
}

startServer();
