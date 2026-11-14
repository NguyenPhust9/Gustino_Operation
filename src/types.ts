export type Role = 'admin' | 'manager' | 'supmt' | 'shift_leader' | 'staff' | 'cashier' | 'kitchen'
export type EmploymentType = 'leader' | 'full_time' | 'part_time'
export type EmploymentStatus = 'probation' | 'working' | 'ended'

export interface AppUser {
  id: string
  name: string
  email: string
  role: Role
  branchId: string
  branchIds?: string[]
  canRoamBranches?: boolean
  authToken?: string
  employmentType?: EmploymentType
  positionTitle?: string
  avatarUrl?: string
}

export interface EmployeeProfile {
  id: string
  name: string
  email?: string
  role: Role
  branchId?: string
  canRoamBranches?: boolean
  active?: boolean
  hasLoginAccount?: boolean
  employmentType?: EmploymentType
  positionTitle?: string
  avatarUrl?: string
  employmentStatus?: EmploymentStatus
  employmentStartDate?: string
  probationEndDate?: string
  employmentEndDate?: string
  employmentNote?: string
}

export interface WorkShift {
  id: string
  branchId: string
  name: string
  startTime: string
  endTime: string
  graceMinutes: number
  recommendedStaff: number
  employmentTypes?: EmploymentType[]
  active: boolean
}

export interface SchedulePerson {
  id: string
  profileId?: string
  name: string
  branchId: string
  employmentType?: EmploymentType
  positionTitle?: string
  active: boolean
  sortOrder: number
}

export interface ScheduleEntry {
  id: string
  personId: string
  branchId: string
  workDate: string
  shiftId?: string
  startTime: string
  endTime: string
  note: string
}

export type ShiftRegistrationStatus = 'pending' | 'approved' | 'rejected'

export interface ShiftRegistration {
  id: string
  userId: string
  userName: string
  employmentType?: EmploymentType
  positionTitle?: string
  branchId: string
  workDate: string
  startTime: string
  endTime: string
  shiftId?: string
  status: ShiftRegistrationStatus
  note: string
  reviewedBy?: string
  reviewedAt?: string
  rejectionReason?: string
  createdAt: string
}

export interface AttendanceRecord {
  id: string
  userId: string
  userName: string
  branchId: string
  shiftRegistrationId: string
  checkInTime: string
  checkOutTime?: string
  selfieUrl: string
  checkOutSelfieUrl?: string
  selfiePreviewUrl?: string
  checkInLatitude?: number
  checkInLongitude?: number
  checkInAccuracy?: number
  checkInAddress?: string
  checkOutLatitude?: number
  checkOutLongitude?: number
  checkOutAccuracy?: number
  checkOutAddress?: string
  createdAt: string
  updatedAt: string
}

export interface AttendanceReportRow {
  userId: string
  employeeName: string
  branchId: string
  totalShifts: number
  totalHours: number
  overtimeHours: number
  workDays: number
  lateCount: number
  absentCount: number
  missingCheckoutCount: number
}

export type AttendanceAdjustmentKind = 'late_arrival' | 'early_leave' | 'missing_checkout'

export interface AttendanceAdjustmentRequest {
  id: string
  userId: string
  userName: string
  branchId: string
  kind: AttendanceAdjustmentKind
  workDate: string
  scheduledTime: string
  actualTime: string
  reason: string
  evidenceNote: string
  createdBy: string
  createdAt: string
}

export interface ActiveUserSession {
  userId: string
  userName: string
  role: Role
  branchId: string
  page: string
  lastSeenAt: string
}

export type BagShiftStatus = 'open' | 'closed'

export interface BagShiftSession {
  id: string
  branchId: string
  businessDate: string
  sequence: number
  leaderId: string
  leaderName: string
  status: BagShiftStatus
  openingBalances: Record<string, number>
  closingBalances?: Record<string, number>
  discrepancyNote?: string
  openingPhotoUrl?: string
  closingPhotoUrl?: string
  startedAt: string
  endedAt?: string
}

export interface BagAllocation {
  id: string
  branchId: string
  shiftId: string
  businessDate?: string
  employeeName: string
  employeeId?: string
  productId: string
  issuedQuantity: number
  soldQuantity?: number
  returnedQuantity: number
  damagedQuantity: number
  issuedBy: string
  issuedAt: string
  settledBy?: string
  settlementShiftId?: string
  settledAt?: string
  postedAt?: string
  postedSoldQuantity?: number
  postedDamagedQuantity?: number
}

export interface CommissionRule {
  id: string
  branchId: string
  targetQuantity: number
  commissionPerUnit: number
  updatedAt: string
}

export type MovementType =
  | 'opening'
  | 'inbound'
  | 'processing_out'
  | 'processing_in'
  | 'packing_out'
  | 'packing_in'
  | 'sale_out'
  | 'waste'
  | 'adjustment'
  | 'count'

export interface Branch {
  id: string
  name: string
}

export interface Product {
  id: string
  sku: string
  name: string
  unit: string
  category: 'raw' | 'finished' | 'packaging'
  lowStock: number
  price?: number
  active?: boolean
  source?: 'system' | 'custom'
  recipe?: ProductRecipeLine[]
  weightKg?: number
  countsForYield?: boolean
  inboundPackKg?: number
  inboundUnit?: string
  inboundPackQuantity?: number
  /** Gợi ý quy cách hiển thị khi nhân viên lập phiếu đặt hàng. */
  orderSpecificationHint?: string
}

export interface ProductRecipeLine {
  productId: string
  quantity: number
  role: 'source' | 'packaging' | 'ingredient'
}

export interface StockMovement {
  id: string
  branchId: string
  productId: string
  type: MovementType
  quantity: number
  shiftDate: string
  note: string
  createdBy: string
  createdAt: string
  sourceProductId?: string
  sourceQuantity?: number
  documentId?: string
  measuredWeightKg?: number
}

export interface StockLine {
  product: Product
  expected: number
  actual?: number
  variance?: number
}

export interface InventoryCountLine {
  productId: string
  freezerQty: number
  stockRoomQty: number
  orderNeeded: number
  varianceReason?: string
  note: string
  /** true = dòng này ĐÃ được kiểm đếm (kể cả khi số lượng = 0). Thiếu = dữ liệu cũ, suy ra từ quantity > 0. */
  counted?: boolean
}

export interface InventoryReport {
  id: string
  reportNo: string
  branchId: string
  reportDate: string
  department: string
  location: string
  shift: string
  reporter: string
  lines: InventoryCountLine[]
  createdBy: string
  createdAt: string
}

export interface ReportSummary {
  revenue: number
  totalIn: number
  totalSold: number
  salesRate: number
  kpi: number
  kitchenLoss: number
  grade: string
  shiftTime: string
  leader: string
}

export interface ReportSnapshot {
  id: string
  branchId: string
  reportDate: string
  payload: {
    state?: Record<string, unknown>
    openingImage?: string
    closingImage?: string
    wasteImage?: string
    bugImage?: string
    summary?: ReportSummary
    dailyReport?: Record<string, unknown>
    bagShiftSummary?: Record<string, unknown>
    shiftReports?: Record<string, {
      shiftId: string
      sequence: number
      scope: string
      leaderId: string
      leaderName: string
      finalizedAt: string
      report: Record<string, unknown>
      zaloIntent?: Record<string, unknown>
      zaloDelivery?: Record<string, unknown>
      n8nDelivery?: Record<string, unknown>
    }>
  }
  createdAt: string
}

export type OperationDayStatus = 'open' | 'closed'

export interface OperationDay {
  id: string
  branchId: string
  businessDate: string
  status: OperationDayStatus
  openedBy: string
  openedAt: string
  closedBy?: string
  closedAt?: string
}
