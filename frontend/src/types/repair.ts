export type SeverityLevel = '轻' | '中' | '重'
export type ChipStatus = '待修' | '待复检' | '已放行'
export type InspectionResult = '通过' | '未过'

/**
 * 一轮修补与复检：
 * 修补人先登记修法与日期，版片进入「待复检」；
 * 复检由另一名师傅看过刀口后回填结论，未过则回到「待修」再起一轮。
 */
export interface RepairRound {
  seq: number
  repairedBy: string
  repairedAt: string
  repairMethod: string
  checkedBy?: string
  checkedAt?: string
  result?: InspectionResult
  checkNote?: string
}

/** 一处崩口的完整修补复检档案，归属于一块版片及其画稿。 */
export interface ChipRepair {
  id: string
  draftId: string
  blockId: string
  position: string
  severity: SeverityLevel
  registeredAt: string
  registeredBy: string
  rounds: RepairRound[]
  status: ChipStatus
  note?: string
}
