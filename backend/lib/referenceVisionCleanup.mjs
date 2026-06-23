/**
 * Remove Vision Pi assets tied to a product reference (program, templates, master in program config).
 */

import { deleteVisionProgramOnPi } from './visionProgramDelete.mjs'

/**
 * @param {import('./visionConfig.mjs').resolveVisionConfig extends (...args: any) => infer R ? R : never} cfg
 * @param {{ name: string, vision_program_id?: number | null, specific_tool_template_id?: number | null }} ref
 */
export async function deleteReferenceVisionOnPi(cfg, ref) {
  const { api, localHeaders } = cfg
  const warnings = []
  const templatesDeleted = []
  let programDeleted = false
  const programId = ref.vision_program_id ?? null

  const templateIds = new Set()
  if (ref.specific_tool_template_id != null) {
    templateIds.add(Number(ref.specific_tool_template_id))
  }

  try {
    const listRes = await fetch(`${api}/tool-templates`, { headers: localHeaders })
    if (listRes.ok) {
      const data = await listRes.json().catch(() => ({}))
      const list = Array.isArray(data) ? data : data.templates ?? []
      const key = String(ref.name ?? '').trim().toLowerCase()
      for (const t of list) {
        if (String(t.name ?? '').trim().toLowerCase() === key && t.id != null) {
          templateIds.add(Number(t.id))
        }
      }
    }
  } catch (err) {
    warnings.push(`List templates: ${err.message}`)
  }

  for (const tid of templateIds) {
    try {
      const res = await fetch(`${api}/tool-templates/${tid}`, {
        method: 'DELETE',
        headers: localHeaders,
      })
      if (res.ok || res.status === 404) {
        templatesDeleted.push(tid)
      } else {
        const body = await res.text().catch(() => '')
        warnings.push(`Template #${tid}: HTTP ${res.status}${body ? ` — ${body.slice(0, 120)}` : ''}`)
      }
    } catch (err) {
      warnings.push(`Template #${tid}: ${err.message}`)
    }
  }

  if (programId != null) {
    const outcome = await deleteVisionProgramOnPi(cfg, programId)
    if (outcome.ok) {
      programDeleted = true
    } else {
      const detail = outcome.error ?? `HTTP ${outcome.status ?? 'error'}`
      const via = outcome.via ? ` (${outcome.via})` : ''
      warnings.push(`Program #${programId}${via}: ${detail}`)
    }
  }

  return { programId, programDeleted, templatesDeleted, warnings }
}
