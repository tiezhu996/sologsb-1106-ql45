import { derived, get, writable } from 'svelte/store'
import type { ChipRepair, InspectionResult, RepairRound, SeverityLevel } from '../types/repair'
import { db } from '../utils/db'

const repairList = writable<ChipRepair[]>([])

/** 按版片归集崩口档案，供编排台与版片时间线共用。 */
const chipsByBlock = derived(repairList, ($repairs) => {
  const grouped: Record<string, ChipRepair[]> = {}
  for (const repair of $repairs) {
    const list = grouped[repair.blockId] ?? []
    list.push(repair)
    grouped[repair.blockId] = list
  }
  for (const blockId of Object.keys(grouped)) {
    grouped[blockId].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id))
  }
  return grouped
})

export interface DraftRepairStats {
  waitingRepair: number
  waitingCheck: number
  released: number
}

/**
 * 编排台按画稿集中显示的崩口数量：
 * 一处崩口算一件，分别统计待修、待复检与已放行。
 */
const statsByDraft = derived(repairList, ($repairs) => {
  const stats: Record<string, DraftRepairStats> = {}
  for (const repair of $repairs) {
    const current = stats[repair.draftId] ?? { waitingRepair: 0, waitingCheck: 0, released: 0 }
    if (repair.status === '待修') current.waitingRepair += 1
    else if (repair.status === '待复检') current.waitingCheck += 1
    else current.released += 1
    stats[repair.draftId] = current
  }
  return stats
})

async function load(): Promise<void> {
  const records = await db.repairs.toArray()
  records.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id))
  repairList.set(records)
}

async function registerChip(input: {
  draftId: string
  blockId: string
  position: string
  severity: SeverityLevel
  registeredBy: string
  registeredAt: string
  note?: string
}): Promise<string> {
  const id = `repair-${crypto.randomUUID()}`
  const record: ChipRepair = {
    id,
    draftId: input.draftId,
    blockId: input.blockId,
    position: input.position,
    severity: input.severity,
    registeredAt: input.registeredAt,
    registeredBy: input.registeredBy,
    rounds: [],
    status: '待修',
    note: input.note,
  }
  await db.repairs.add(record)
  await load()
  return id
}

/**
 * 修补人交活：记录修法、修补人与日期，崩口进入待复检。
 * 未通过复检退回待修后可再次修补，新一轮顺序接在旧记录之后。
 */
async function submitRepair(
  repairId: string,
  round: Pick<RepairRound, 'repairedBy' | 'repairedAt' | 'repairMethod'>,
): Promise<void> {
  const existing = await db.repairs.get(repairId)
  if (!existing || existing.status === '已放行') return

  const nextRound: RepairRound = {
    seq: existing.rounds.length + 1,
    repairedBy: round.repairedBy,
    repairedAt: round.repairedAt,
    repairMethod: round.repairMethod,
  }
  await db.repairs.update(repairId, {
    rounds: [...existing.rounds, nextRound],
    status: '待复检',
  })
  await load()
}

/**
 * 复检登记：复检师傅必须不同于本轮修补人。
 * 通过即放行（版片此后可刻成）；未过则回到待修，旧轮次保留可回看。
 */
async function submitInspection(
  repairId: string,
  inspection: { checkedBy: string; checkedAt: string; result: InspectionResult; checkNote?: string },
): Promise<{ ok: boolean; message?: string }> {
  const existing = await db.repairs.get(repairId)
  if (!existing) return { ok: false, message: '未找到这处崩口档案。' }
  if (existing.status !== '待复检') return { ok: false, message: '这处崩口当前不在待复检。' }

  const latest = existing.rounds[existing.rounds.length - 1]
  if (latest && latest.repairedBy === inspection.checkedBy) {
    return { ok: false, message: '复检须由另一名师傅看过刀口，不能本人验本人。' }
  }

  const updatedRound: RepairRound = {
    ...latest,
    checkedBy: inspection.checkedBy,
    checkedAt: inspection.checkedAt,
    result: inspection.result,
    checkNote: inspection.checkNote,
  }
  const rounds = [...existing.rounds.slice(0, -1), updatedRound]
  await db.repairs.update(repairId, {
    rounds,
    status: inspection.result === '通过' ? '已放行' : '待修',
  })
  await load()
  return { ok: true }
}

async function removeChip(repairId: string): Promise<void> {
  const existing = await db.repairs.get(repairId)
  // 已有修补记录的崩口要留痕，只允许删除误登记、尚未开修的空档。
  if (!existing || existing.rounds.length > 0) return
  await db.repairs.delete(repairId)
  await load()
}

/** 版片是否还有未放行的崩口（待修或待复检）。 */
function hasOpenChip(blockId: string): boolean {
  return get(repairList).some((repair) => repair.blockId === blockId && repair.status !== '已放行')
}

export const repairStore = {
  subscribe: repairList.subscribe,
  chipsByBlock,
  statsByDraft,
  load,
  registerChip,
  submitRepair,
  submitInspection,
  removeChip,
  hasOpenChip,
}
