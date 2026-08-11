const express = require('express')
const router = express.Router()

/**
 * Proxy seguro a OpenAI.
 *
 * La API key vive solo en OPENAI_API_KEY del backend (variable de entorno).
 * El frontend nunca la ve. Cualquier costo/abuso queda controlado en el servidor.
 *
 * POST /api/ai/generate
 * body: {
 *   prompt: string,                                       // requerido
 *   images?: Array<{ mimeType: string, data: string }>,   // base64 sin prefijo
 *   model?: string,                                       // default 'gpt-4o-mini'
 *   temperature?: number,                                 // default 0.7
 *   maxOutputTokens?: number                              // default 4096
 * }
 *
 * response: {
 *   text: string,   // contenido generado
 *   model: string,  // modelo usado (puede haber fallback)
 * }
 */
router.post('/generate', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY no configurada en el servidor' })
  }

  const {
    prompt,
    images,
    model = 'gpt-4o-mini',
    temperature = 0.7,
    maxOutputTokens = 4096
  } = req.body || {}

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt es requerido (string)' })
  }
  if (prompt.length > 30000) {
    return res.status(413).json({ error: 'prompt demasiado largo (max 30k caracteres)' })
  }

  const content = [{ type: 'text', text: prompt }]
  if (Array.isArray(images)) {
    images.slice(0, 6).forEach((img) => {
      if (img && img.mimeType && img.data) {
        content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })
      }
    })
  }

  // Lista de modelos a intentar en orden (fallback automático si uno falla) —
  // todos gama económica, gpt-4o-mini primero por ser el más barato/rápido.
  const fallbackModels = [model, 'gpt-4o-mini', 'gpt-4.1-mini']
    .filter((m, idx, arr) => arr.indexOf(m) === idx) // dedupe

  let lastError = null
  for (const tryModel of fallbackModels) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: tryModel,
          messages: [{ role: 'user', content }],
          temperature,
          max_tokens: maxOutputTokens
        })
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        lastError = `(${response.status}) ${errBody?.error?.message || response.statusText}`
        // Si es un error de request inválida que no depende del modelo, no seguir intentando.
        if (response.status >= 400 && response.status < 500 && errBody?.error?.code !== 'model_not_found') {
          return res.status(response.status).json({ error: `OpenAI rechazó la solicitud: ${lastError}` })
        }
        continue
      }

      const data = await response.json()
      const text = data?.choices?.[0]?.message?.content
      if (!text) {
        lastError = 'OpenAI devolvió respuesta vacía'
        continue
      }

      return res.json({ text, model: tryModel })
    } catch (err) {
      lastError = err.message
      continue
    }
  }

  return res.status(502).json({ error: `OpenAI falló en todos los modelos: ${lastError}` })
})

module.exports = router
