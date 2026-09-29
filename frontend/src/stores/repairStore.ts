import { derived, writable } from 'svelte/store'
import type { ChipRepair, ChipSeverity, DraftRepairStats, RepairEvent } from '../types/repair'
import { db } from '../utils/db'

const repairList = writable<ChipRepair[]>([])

export interface RegisterRepairInput {
  blockId: string
  draftId: string
  location: string
  severity: ChipSeverity
  foundAt: string
  repairBy: string
  repairedAt: string
  repairNote: string
  directSubmit: boolean
}

export interface ReviewOutcome {
  ok: boolean
  message: string
}

const emptyStats = (): DraftRepairStats => ({ waitingRepair: 0, waitingReview: 0, released: 0, openCount: 0 })

export function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 16)
}

function appendEvent(repair: ChipRepair, event: RepairEvent): void {
  repair.events = [...repair.events, event]
}

/** 按画稿汇总待修 / 待复检 / 已放行数量，供编排台集中显示。 */
export const statsByDraft = derived(repairList, ($repairs) => {
  const stats: Record<string, DraftRepairStats> = {}
  for (const repair of $repairs) {
    const current = stats[repair.draftId] ?? emptyStats()
    if (repair.status === '待修') {
      current.waitingRepair += 1
      current.openCount += 1
    } else if (repair.status === '待复检') {
      current.waitingReview += 1
      current.openCount += 1
    } else {
      current.released += 1
    }
    stats[repair.draftId] = current
  }
  return stats
})

export const openCountByBlock = derived(repairList, ($repairs) => {
  const counts: Record<string, number> = {}
  for (const repair of $repairs) {
    if (repair.status === '已放行') continue
    counts[repair.blockId] = (counts[repair.blockId] ?? 0) + 1
  }
  return counts
})

async function load(): Promise<void> {
  const records = await db.repairs.toArray()
  records.sort((a, b) => a.draftId.localeCompare(b.draftId) || a.blockId.localeCompare(b.blockId) || a.seq - b.seq)
  repairList.set(records)
}

async function nextSeq(blockId: string): Promise<number> {
  const sameBlock = await db.repairs.where('blockId').equals(blockId).toArray()
  return sameBlock.reduce((max, item) => Math.max(max, item.seq), 0) + 1
}

async function register(input: RegisterRepairInput): Promise<string> {
  const id = `repair-${crypto.randomUUID()}`
  const submitNow = input.directSubmit && input.repairBy.trim() !== '' && input.repairedAt !== ''
  const events: RepairEvent[] = [
    {
      at: nowStamp(),
      type: '登记',
      actor: submitNow ? input.repairBy.trim() : '当班刻工',
      note: submitNow ? '登记崩口，发现时已修补，随附修补记录。' : '登记崩口，列入待修。',
    },
  ]
  if (submitNow) {
    events.push({ at: nowStamp(), type: '送检', actor: input.repairBy.trim(), note: input.repairNote.trim() || '修完送检。' })
  }

  const record: ChipRepair = {
    id,
    blockId: input.blockId,
    draftId: input.draftId,
    seq: await nextSeq(input.blockId),
    location: input.location.trim(),
    severity: input.severity,
    status: submitNow ? '待复检' : '待修',
    foundAt: input.foundAt,
    repairBy: submitNow ? input.repairBy.trim() : '',
    repairedAt: submitNow ? input.repairedAt : '',
    repairNote: submitNow ? input.repairNote.trim() : '',
    reviewBy: '',
    reviewedAt: '',
    reviewNote: '',
    events,
  }
  await db.repairs.add(record)
  await load()
  return id
}

/** 修完送检：补齐修补人与修补日期，崩口进入待复检。 */
async function submitForReview(
  id: string,
  patch: { repairBy: string; repairedAt: string; repairNote: string },
): Promise<ReviewOutcome> {
  const repair = await db.repairs.get(id)
  if (!repair || repair.status === '已放行') return { ok: false, message: '已放行的崩口不能再送检。' }
  if (!patch.repairBy.trim()) return { ok: false, message: '请填写修补人。' }
  if (!patch.repairedAt) return { ok: false, message: '请填写修补日期。' }

  await db.repairs.update(id, {
    status: '待复检',
    repairBy: patch.repairBy.trim(),
    repairedAt: patch.repairedAt,
    repairNote: patch.repairNote.trim(),
  })
  await db.repairs.update(id, (current) => {
    appendEvent(current, { at: nowStamp(), type: '送检', actor: patch.repairBy.trim(), note: patch.repairNote.trim() || '修完送检。' })
  })
  await load()
  return { ok: true, message: '已送检，等另一名师傅复检。' }
}

/** 复检：复检师傅必须与修补人不是同一人，刀口不再崩线才放行。 */
async function review(
  id: string,
  input: { reviewBy: string; reviewedAt: string; reviewNote: string; passed: boolean },
): Promise<ReviewOutcome> {
  const repair = await db.repairs.get(id)
  if (!repair) return { ok: false, message: '未找到这条崩口记录。' }
  if (repair.status !== '待复检') return { ok: false, message: '只有待复检的崩口能复检。' }
  if (!input.reviewBy.trim()) return { ok: false, message: '请填写复检师傅。' }
  if (!input.reviewedAt) return { ok: false, message: '请填写复检日期。' }
  if (input.reviewBy.trim() === repair.repairBy) {
    return { ok: false, message: '复检须由修补人之外的另一名师傅查看，请换人复检。' }
  }

  if (input.passed) {
    await db.repairs.update(id, {
      status: '已放行',
      reviewBy: input.reviewBy.trim(),
      reviewedAt: input.reviewedAt,
      reviewNote: input.reviewNote.trim() || '刀口不再崩线。',
    })
    await db.repairs.update(id, (current) => {
      appendEvent(current, {
        at: nowStamp(),
        type: '复检通过',
        actor: input.reviewBy.trim(),
        note: input.reviewNote.trim() || '刀口不再崩线，放行。',
      })
    })
    await load()
    return { ok: true, message: '复检通过，已放行。' }
  }

  // 退回重修：清空上一轮复检结论字段，退回原因记入流水，崩口回到待修。
  await db.repairs.update(id, {
    status: '待修',
    reviewBy: '',
    reviewedAt: '',
    reviewNote: '',
  })
  await db.repairs.update(id, (current) => {
    appendEvent(current, {
      at: nowStamp(),
      type: '退回重修',
      actor: input.reviewBy.trim(),
      note: input.reviewNote.trim() || '刀口仍崩线，退回重修。',
    })
  })
  await load()
  return { ok: true, message: '已退回重修，修完后可再次送检。' }
}

async function remove(id: string): Promise<ReviewOutcome> {
  const repair = await db.repairs.get(id)
  if (!repair) return { ok: false, message: '未找到这条崩口记录。' }
  if (repair.status !== '待修') {
    return { ok: false, message: '已送检或已放行的记录须保留追溯，不能删除。' }
  }
  await db.repairs.delete(id)
  await load()
  return { ok: true, message: '待修崩口登记已删除。' }
}

export const repairStore = {
  subscribe: repairList.subscribe,
  statsByDraft,
  openCountByBlock,
  load,
  register,
  submitForReview,
  review,
  remove,
}
