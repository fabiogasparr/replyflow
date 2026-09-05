import ContactProfile from "@/components/contact-profile";

export default async function ContactProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactProfile key={id} contactId={id} />;
}
