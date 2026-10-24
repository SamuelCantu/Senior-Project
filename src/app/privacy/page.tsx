export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-3xl font-bold">
        ListNexus Privacy Policy
      </h1>

      <p className="mb-4">
        ListNexus is a student-developed application designed to help users
        create and manage marketplace listings from one location.
      </p>

      <h2 className="mb-2 mt-6 text-xl font-semibold">
        Information We Access
      </h2>

      <p className="mb-4">
        When you connect an eBay account, ListNexus may access information
        authorized by you through eBay, including inventory, offers, and order
        fulfillment information.
      </p>

      <h2 className="mb-2 mt-6 text-xl font-semibold">
        How We Use Information
      </h2>

      <p className="mb-4">
        Information obtained through marketplace integrations is used only to
        provide ListNexus features such as listing management, inventory
        synchronization, and order management.
      </p>

      <h2 className="mb-2 mt-6 text-xl font-semibold">
        Account Credentials
      </h2>

      <p className="mb-4">
        ListNexus does not request or store your eBay password. Marketplace
        access is authorized using OAuth access tokens provided by eBay.
      </p>

      <h2 className="mb-2 mt-6 text-xl font-semibold">
        Data Sharing
      </h2>

      <p className="mb-4">
        ListNexus does not sell personal information. Information is shared
        only as necessary to provide marketplace integration features or when
        required by law.
      </p>

      <h2 className="mb-2 mt-6 text-xl font-semibold">
        Contact
      </h2>

      <p>
        Questions regarding this privacy policy may be directed to the
        ListNexus development team.
      </p>
    </main>
  );
}