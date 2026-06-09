import AppLayout from '@/components/AppLayout'

export default function InicioPage() {
  return (
    <AppLayout>
      <div className="flex flex-1 items-center justify-center bg-gray-50 p-6">
        <img
          src="/logo.jpeg"
          alt="Ogemi"
          className="h-40 w-40 rounded-full bg-white object-contain p-4 shadow-xl sm:h-52 sm:w-52"
        />
      </div>
    </AppLayout>
  )
}
