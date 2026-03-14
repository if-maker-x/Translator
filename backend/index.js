import cors from 'cors'
import express from 'express'
import mammoth from 'mammoth'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import WordExtractor from 'word-extractor'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import translate from 'google-translate-api-x'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadDir = path.join(__dirname, 'uploads')
const extractor = new WordExtractor()

const languageLabels = {
  auto: '自动识别',
  en: '英语',
  'zh-CN': '中文',
}

const supportedLanguages = new Set(Object.keys(languageLabels))
const maxSentenceCount = 160
const maxBatchChars = 1800
const maxBatchSentences = 8
const app = express()

await fs.mkdir(uploadDir, { recursive: true })

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
})

app.use(
  cors({
    origin: '*',
  }),
)

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.post('/api/documents/translate', upload.single('file'), async (request, response) => {
  const uploadedFile = request.file

  if (!uploadedFile) {
    response.status(400).json({ error: '没有收到上传文件。' })
    return
  }

  try {
    const sourceLanguage = normalizeSourceLanguage(request.body.sourceLanguage)
    const targetLanguage = normalizeTargetLanguage(request.body.targetLanguage)
    const extractedText = await extractTextFromFile(uploadedFile.path, uploadedFile.originalname)
    const cleanedText = normalizeDocumentText(extractedText)

    if (!cleanedText) {
      response.status(400).json({ error: '文档中没有提取到可翻译文本。' })
      return
    }

    const sentences = splitIntoSentences(cleanedText)
    if (!sentences.length) {
      response.status(400).json({ error: '文档清洗后没有保留可对照的英文句子。' })
      return
    }

    const warnings = []
    const visibleSentences = sentences.slice(0, maxSentenceCount)

    if (sentences.length > maxSentenceCount) {
      warnings.push(`文档较长，当前只展示前 ${maxSentenceCount} 句。`)
    }

    const translatedSentences = await translateSentenceCollection(
      visibleSentences,
      sourceLanguage,
      targetLanguage,
    )

    const alignedSentences = visibleSentences.map((sourceText, index) => ({
      id: `sentence-${index}`,
      index,
      sourceText,
      translationText: translatedSentences[index] ?? '',
    }))

    response.json({
      fileName: uploadedFile.originalname,
      sourceLanguage,
      sourceLanguageLabel: languageLabels[sourceLanguage] ?? sourceLanguage,
      targetLanguage,
      targetLanguageLabel: languageLabels[targetLanguage] ?? targetLanguage,
      sentenceCount: alignedSentences.length,
      warnings,
      sentences: alignedSentences,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器处理文档时失败。'
    response.status(500).json({ error: message })
  } finally {
    await fs.rm(uploadedFile.path, { force: true })
  }
})

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => {
  console.log(`Document translation backend listening on http://localhost:${port}`)
})

function normalizeSourceLanguage(value) {
  const normalized = String(value ?? 'en').trim().toLowerCase()
  if (normalized === 'auto') {
    return 'en'
  }

  return supportedLanguages.has(normalized) ? normalized : 'en'
}

function normalizeTargetLanguage(value) {
  const normalized = String(value ?? 'zh-CN').trim()
  if (normalized === 'zh' || normalized.toLowerCase() === 'zh-cn') {
    return 'zh-CN'
  }

  return supportedLanguages.has(normalized) && normalized !== 'auto' ? normalized : 'zh-CN'
}

async function extractTextFromFile(filePath, originalName) {
  const extension = path.extname(originalName).toLowerCase()

  if (extension === '.pdf') {
    return extractPdfText(filePath)
  }

  if (extension === '.docx') {
    return extractDocxText(filePath)
  }

  if (extension === '.doc') {
    return extractDocText(filePath)
  }

  if (extension === '.txt') {
    return fs.readFile(filePath, 'utf8')
  }

  throw new Error('暂不支持该文件类型，请上传 pdf、doc、docx 或 txt。')
}

async function extractPdfText(filePath) {
  const buffer = await fs.readFile(filePath)
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}

async function extractDocxText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

async function extractDocText(filePath) {
  const document = await extractor.extract(filePath)
  return [document.getBody(), document.getFootnotes(), document.getEndnotes()]
    .filter(Boolean)
    .join('\n')
}

function normalizeDocumentText(text) {
  const normalized = text
    .replace(/\u0000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/-\n/g, '')
    .replace(/[ \t]+/g, ' ')

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const lineCounts = new Map()
  for (const line of lines) {
    lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1)
  }

  const filteredLines = lines.filter((line) => {
    if (/^\d+$/.test(line)) {
      return false
    }

    const count = lineCounts.get(line) ?? 0
    if (count >= 3 && line.length <= 80) {
      return false
    }

    return true
  })

  const mergedParagraphs = []
  let current = ''

  for (const line of filteredLines) {
    const startsNewSentence = /^[A-Z("']/.test(line)
    const endsLikeParagraph = /[.!?:"”)]$/.test(current)
    const shouldBreak = current && endsLikeParagraph && startsNewSentence

    if (!current) {
      current = line
      continue
    }

    if (shouldBreak) {
      mergedParagraphs.push(current)
      current = line
      continue
    }

    current = `${current} ${line}`.replace(/\s+/g, ' ').trim()
  }

  if (current) {
    mergedParagraphs.push(current)
  }

  return mergedParagraphs.join('\n\n').trim()
}

function splitIntoSentences(text) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const sentences = []

  for (const block of blocks) {
    const fragments = block.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [block]

    for (const fragment of fragments) {
      const sentence = fragment.replace(/\s+/g, ' ').trim()
      if (sentence.length >= 2) {
        sentences.push(sentence)
      }
    }
  }

  return sentences
}

async function translateSentenceCollection(sentences, sourceLanguage, targetLanguage) {
  const batches = buildSentenceBatches(sentences)
  const translatedBatches = await mapLimit(batches, 2, async (batch) => {
    return translateSentenceBatch(batch, sourceLanguage, targetLanguage)
  })

  return translatedBatches.flat()
}

function buildSentenceBatches(sentences) {
  const batches = []
  let currentBatch = []
  let currentChars = 0

  for (const sentence of sentences) {
    const extraChars = sentence.length + 8
    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= maxBatchSentences || currentChars + extraChars > maxBatchChars)
    ) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(sentence)
    currentChars += extraChars
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

async function translateSentenceBatch(sentences, sourceLanguage, targetLanguage) {
  const numberedPayload = sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n')
  const batchTranslation = await translateText(numberedPayload, sourceLanguage, targetLanguage)
  const parsedTranslations = parseNumberedTranslations(batchTranslation, sentences.length)

  if (parsedTranslations.length === sentences.length && parsedTranslations.every(Boolean)) {
    return parsedTranslations.map((item) => polishChineseText(item))
  }

  const fallbackTranslations = await mapLimit(sentences, 3, async (sentence) => {
    const translated = await translateText(sentence, sourceLanguage, targetLanguage)
    return polishChineseText(translated)
  })

  return fallbackTranslations
}

function parseNumberedTranslations(text, expectedCount) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const results = new Array(expectedCount).fill('')

  for (const line of lines) {
    const match = line.match(/^(\d+)[.)、:：-]?\s*(.*)$/)
    if (!match) {
      continue
    }

    const index = Number(match[1]) - 1
    if (index >= 0 && index < expectedCount) {
      results[index] = match[2].trim()
    }
  }

  return results.filter(Boolean)
}

function polishChineseText(text) {
  return text
    .replace(/^\d+[.)、:：-]?\s*/g, '')
    .replace(/\s+/g, '')
    .replace(/, /g, '，')
    .replace(/,\s*/g, '，')
    .replace(/:\s*/g, '：')
    .replace(/;\s*/g, '；')
    .replace(/\?\s*/g, '？')
    .replace(/!\s*/g, '！')
    .replace(/\.\s*$/g, '。')
    .trim()
}

async function translateText(text, sourceLanguage, targetLanguage) {
  if (!text.trim() || sourceLanguage === targetLanguage) {
    return text
  }

  try {
    return await translateWithMyMemory(text, sourceLanguage, targetLanguage)
  } catch (_primaryError) {
    try {
      const result = await translate(text, {
        from: sourceLanguage,
        to: targetLanguage,
        client: 'gtx',
      })

      return typeof result === 'string' ? result : result.text
    } catch (_secondaryError) {
      return text
    }
  }
}

async function translateWithMyMemory(text, sourceLanguage, targetLanguage) {
  const query = new URLSearchParams({
    q: text,
    langpair: `${sourceLanguage}|${targetLanguage}`,
  })

  const requestUrl = `https://api.mymemory.translated.net/get?${query.toString()}`
  const result = await fetch(requestUrl, {
    headers: {
      accept: 'application/json',
    },
  })

  if (!result.ok) {
    throw new Error(`翻译服务暂时不可用：${result.status}`)
  }

  const payload = await result.json()
  const translatedText = payload?.responseData?.translatedText

  if (!translatedText || typeof translatedText !== 'string') {
    throw new Error('翻译服务未返回有效文本。')
  }

  return decodeHtmlEntities(translatedText)
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function mapLimit(items, limit, iteratee) {
  const result = new Array(items.length)
  let index = 0

  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (true) {
      const currentIndex = index
      index += 1

      if (currentIndex >= items.length) {
        return
      }

      result[currentIndex] = await iteratee(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return result
}
