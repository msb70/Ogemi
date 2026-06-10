'use client'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-lg md:text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:gap-3">{actions}</div>}
    </div>
  )
}
