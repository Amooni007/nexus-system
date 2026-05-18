import Sidebar from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-slate-950 flex">
      <Sidebar />
      {/* ✅ On mobile: no left margin (sidebar is a drawer). On desktop: ml-64 */}
      <main className="flex-1 min-h-screen lg:ml-64">
        {/* ✅ On mobile: top padding for the fixed mobile topbar (pt-16) */}
        <div className="px-4 py-6 pt-20 lg:pt-8 lg:px-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}