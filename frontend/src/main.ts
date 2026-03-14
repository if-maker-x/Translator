import { computed, createApp, ref } from 'vue/dist/vue.esm-bundler.js'
import './style.css'

type SentenceAlignment = {
  id: string
  index: number
  sourceText: string
  translationText: string
}

type TranslationResponse = {
  fileName: string
  sourceLanguage: string
  sourceLanguageLabel: string
  targetLanguage: string
  targetLanguageLabel: string
  sentenceCount: number
  warnings: string[]
  sentences: SentenceAlignment[]
}

const importMetaEnv = import.meta as ImportMeta & {
  env?: {
    VITE_API_BASE?: string
  }
}

const apiBase = importMetaEnv.env?.VITE_API_BASE ?? 'http://localhost:3001'

createApp({
  setup() {
    const selectedFile = ref<File | null>(null)
    const loading = ref(false)
    const errorMessage = ref('')
    const activeSentenceId = ref('')
    const documentData = ref<TranslationResponse | null>(null)

    const canUpload = computed(() => {
      return Boolean(selectedFile.value) && !loading.value
    })

    const sentenceCountLabel = computed(() => {
      if (!documentData.value) {
        return '等待上传文档'
      }

      return `共 ${documentData.value.sentenceCount} 句`
    })

    function handleFileChange(event: Event) {
      const input = event.target as HTMLInputElement
      selectedFile.value = input.files?.[0] ?? null
      errorMessage.value = ''
    }

    function clearHighlight() {
      activeSentenceId.value = ''
    }

    function setSentenceHighlight(sentenceId: string) {
      activeSentenceId.value = sentenceId
    }

    async function uploadDocument() {
      if (!selectedFile.value) {
        errorMessage.value = '请先选择一个 PDF、DOC、DOCX 或 TXT 文件。'
        return
      }

      loading.value = true
      errorMessage.value = ''
      clearHighlight()

      try {
        const formData = new FormData()
        formData.append('file', selectedFile.value)
        formData.append('sourceLanguage', 'en')
        formData.append('targetLanguage', 'zh-CN')

        const response = await fetch(`${apiBase}/api/documents/translate`, {
          method: 'POST',
          body: formData,
        })

        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error ?? '文档处理失败。')
        }

        documentData.value = payload as TranslationResponse
      } catch (error) {
        errorMessage.value =
          error instanceof Error ? error.message : '上传过程中出现未知错误。'
      } finally {
        loading.value = false
      }
    }

    return {
      activeSentenceId,
      canUpload,
      clearHighlight,
      documentData,
      errorMessage,
      handleFileChange,
      loading,
      selectedFile,
      sentenceCountLabel,
      setSentenceHighlight,
      uploadDocument,
    }
  },
  template: `
    <main class="page-shell">
      <section class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">English to Chinese</p>
          <h1>上传英文文档，生成更干净的中英对照阅读页。</h1>
          <p class="hero-text">
            左侧只显示英文原句，右侧只显示对应中文译句。鼠标放到任意一侧的某一句时，另一侧对应句会同步高亮，适合连续阅读和人工校对。
          </p>
        </div>

        <div class="upload-card">
          <label class="file-drop">
            <input class="file-input" type="file" accept=".pdf,.doc,.docx,.txt" @change="handleFileChange" />
            <span class="file-title">{{ selectedFile ? selectedFile.name : '选择英文文档' }}</span>
            <span class="file-tip">支持 PDF / DOC / DOCX / TXT，默认翻译为中文</span>
          </label>

          <button class="upload-button" :disabled="!canUpload" @click="uploadDocument">
            {{ loading ? '正在解析并翻译...' : '生成句子对照' }}
          </button>

          <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

          <div class="meta-strip">
            <div>
              <span class="meta-label">原文</span>
              <strong>英语</strong>
            </div>
            <div>
              <span class="meta-label">译文</span>
              <strong>中文</strong>
            </div>
            <div>
              <span class="meta-label">状态</span>
              <strong>{{ sentenceCountLabel }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section v-if="documentData" class="workspace">
        <header class="workspace-header">
          <div>
            <p class="eyebrow">当前文档</p>
            <h2>{{ documentData.fileName }}</h2>
          </div>
          <div class="warning-stack" v-if="documentData.warnings.length">
            <span v-for="warning in documentData.warnings" :key="warning" class="warning-pill">
              {{ warning }}
            </span>
          </div>
        </header>

        <div class="compare-grid" @mouseleave="clearHighlight">
          <section class="compare-column">
            <div class="column-header">
              <p>英文原文</p>
              <span>Sentence by sentence</span>
            </div>

            <article
              v-for="sentence in documentData.sentences"
              :key="sentence.id"
              class="sentence-card"
              :class="{ active: activeSentenceId === sentence.id }"
              @mouseenter="setSentenceHighlight(sentence.id)"
            >
              <span class="sentence-index">S{{ sentence.index + 1 }}</span>
              <p class="source-line">{{ sentence.sourceText }}</p>
            </article>
          </section>

          <section class="compare-column translation-column">
            <div class="column-header">
              <p>中文译文</p>
              <span>Aligned translation</span>
            </div>

            <article
              v-for="sentence in documentData.sentences"
              :key="sentence.id + '-translation'"
              class="sentence-card translation-card"
              :class="{ active: activeSentenceId === sentence.id }"
              @mouseenter="setSentenceHighlight(sentence.id)"
            >
              <span class="sentence-index">T{{ sentence.index + 1 }}</span>
              <p class="translation-line">{{ sentence.translationText }}</p>
            </article>
          </section>
        </div>
      </section>

      <section v-else class="empty-state">
        <div class="empty-card">
          <p class="eyebrow">使用方式</p>
          <h2>上传后自动生成一一对应的双栏句子视图。</h2>
          <p>
            现在不再显示逐词译文，界面只保留“英文句子”和“中文句子”的一对一映射，更适合正常阅读、查句和校对。
          </p>
        </div>
      </section>
    </main>
  `,
}).mount('#app')
