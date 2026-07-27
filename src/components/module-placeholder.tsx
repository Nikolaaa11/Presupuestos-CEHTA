export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-lavender bg-white p-10 text-center">
        <p className="mx-auto max-w-lg text-sm leading-relaxed text-ink-soft">
          {description}
        </p>
      </div>
    </div>
  );
}
