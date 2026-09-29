export type ChipSeverity = '轻微' | '一般' | '严重'
export type ChipStatus = '待修' | '待复检' | '已放行'
export type RepairEventType = '登记' | '送检' | '复检通过' | '退回重修'

export interface RepairEvent {
  at: string
  type: RepairEventType
  actor: string
  note: string
}

export interface ChipRepair {
  id: string
  blockId: string
  draftId: string
  seq: number
  location: string
  severity: ChipSeverity
  status: ChipStatus
  foundAt: string
  repairBy: string
  repairedAt: string
  repairNote: string
  reviewBy: string
  reviewedAt: string
  reviewNote: string
  events: RepairEvent[]
}

export interface DraftRepairStats {
  waitingRepair: number
  waitingReview: number
  released: number
  openCount: number
}
