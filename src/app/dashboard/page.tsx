import Link from "next/link";

const overview = [
  { label: "Active listings", value: "0" },
  { label: "Drafts", value: "0" },
  { label: "Inventory items", value: "0" },
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="text-xl font-bold text-blue-600" href="/">
            ListNexus
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium">
            <Link className="text-blue-700" href="/dashboard">
              Dashboard
            </Link>
            <Link className="text-blue-700" href="/dashboard">
              Settings
            </Link>
            <Link className="text-gray-600 hover:text-blue-600" href="/login">
              Log out
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 text-3xl font-bold">
              <span className="text-blue-600">Hello User,</span>
            </div>
            <h1 className="text-3xl font-bold">ListNexus Station</h1>
            <p className="mt-2 text-gray-600">Keep track of your listings here!</p>
          </div>
        </section>

        <div className="flex gap-8">
          <section className="flex-1 rounded-[14px] border border-[#2e2e2e] bg-[#f5f5f5] p-4">
            <div className="flex min-h-[420px] items-center justify-center text-center">
              <div>
                <h2 className="text-[2.1rem] font-semibold text-black">No listings yet</h2>
                <p className="mt-6 text-[1.15rem] italic text-gray-500">
                  Start with a product and create your first marketplace listing.
                </p>
                <Link
                  className="mt-8 inline-block text-blue-600 underline decoration-blue-600 underline-offset-4"
                  href="/ai"
                >
                  Create your first listing
                </Link>
              </div>
            </div>
          </section>

          <aside className="w-[340px] space-y-5">
            {overview.map((item) => (
              <div
                key={item.label}
                className="rounded-[14px] border border-[#2e2e2e] bg-[#f8f8f8] p-5"
              >
                <p className="text-sm text-gray-600">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold">{item.value}</p>
              </div>
            ))}
          </aside>
        </div>

        <div className="mt-8">
          <Link
            href="/ai"
            className="flex h-[72px] items-center justify-center rounded-lg bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700"
          >
            Create a listing
          </Link>
        </div>
      </div>
    </main>
  );
}