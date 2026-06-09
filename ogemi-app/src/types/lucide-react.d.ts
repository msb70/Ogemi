declare module 'lucide-react' {
  import type { FC, SVGProps } from 'react'

  export interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: string | number
    absoluteStrokeWidth?: boolean
  }

  export type LucideIcon = FC<LucideProps>

  export const AlertCircle: LucideIcon
  export const BarChart3: LucideIcon
  export const BookOpen: LucideIcon
  export const Building2: LucideIcon
  export const Calendar: LucideIcon
  export const CalendarClock: LucideIcon
  export const CalendarDays: LucideIcon
  export const Camera: LucideIcon
  export const CameraOff: LucideIcon
  export const Check: LucideIcon
  export const CheckCircle: LucideIcon
  export const ChevronRight: LucideIcon
  export const Clock: LucideIcon
  export const Copy: LucideIcon
  export const ClipboardList: LucideIcon
  export const CreditCard: LucideIcon
  export const Download: LucideIcon
  export const Eye: LucideIcon
  export const FileSpreadsheet: LucideIcon
  export const FileText: LucideIcon
  export const KeyRound: LucideIcon
  export const Filter: LucideIcon
  export const LayoutDashboard: LucideIcon
  export const Link: LucideIcon
  export const Loader2: LucideIcon
  export const Lock: LucideIcon
  export const LogOut: LucideIcon
  export const Mail: LucideIcon
  export const Minus: LucideIcon
  export const Pencil: LucideIcon
  export const Plus: LucideIcon
  export const Printer: LucideIcon
  export const QrCode: LucideIcon
  export const RefreshCw: LucideIcon
  export const Save: LucideIcon
  export const Search: LucideIcon
  export const Shield: LucideIcon
  export const ShieldCheck: LucideIcon
  export const ShieldOff: LucideIcon
  export const ShoppingCart: LucideIcon
  export const Trash2: LucideIcon
  export const TrendingDown: LucideIcon
  export const TrendingUp: LucideIcon
  export const Truck: LucideIcon
  export const Upload: LucideIcon
  export const UserCheck: LucideIcon
  export const UserPlus: LucideIcon
  export const Users: LucideIcon
  export const UserX: LucideIcon
  export const Wallet: LucideIcon
  export const WalletCards: LucideIcon
  export const X: LucideIcon
}
