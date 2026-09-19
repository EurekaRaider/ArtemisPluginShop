export const pluginLocales = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt-BR",
  "it",
  "ru",
  "ar",
  "hi",
  "id",
];

export function verifyPluginLocalizations(manifest) {
  const localizations = manifest.localizations;
  const fail = () => {
    throw new Error(
      `Plugin ${manifest.name} must provide complete metadata in all 14 Artemis languages.`,
    );
  };
  if (
    !localizations ||
    Object.keys(localizations).sort().join() !==
      [...pluginLocales].sort().join()
  )
    fail();
  const english = {
    displayName: manifest.interface.displayName,
    description: manifest.description,
    shortDescription: manifest.interface.shortDescription,
    ...(manifest.interface.longDescription
      ? { longDescription: manifest.interface.longDescription }
      : {}),
    ...(manifest.interface.defaultPrompt
      ? { defaultPrompt: manifest.interface.defaultPrompt }
      : {}),
  };
  const limits = {
    displayName: 120,
    description: 2_000,
    shortDescription: 300,
    longDescription: 10_000,
    defaultPrompt: 2_000,
  };
  for (const locale of pluginLocales) {
    const copy = localizations[locale];
    if (
      !copy ||
      Object.keys(copy).sort().join() !== Object.keys(english).sort().join()
    )
      fail();
    for (const [key, fallback] of Object.entries(english)) {
      const value = copy[key];
      if (
        Array.isArray(fallback) &&
        (!Array.isArray(value) || value.length !== fallback.length)
      )
        fail();
      if (!Array.isArray(fallback) && typeof value !== "string") fail();
      const strings = Array.isArray(value) ? value : [value];
      if (
        strings.some(
          (text) =>
            typeof text !== "string" ||
            !text.trim() ||
            text.length > limits[key],
        )
      )
        fail();
      if (locale === "en" && JSON.stringify(value) !== JSON.stringify(fallback))
        fail();
      if (
        locale !== "en" &&
        key !== "displayName" &&
        JSON.stringify(value) === JSON.stringify(fallback)
      )
        fail();
    }
  }
}
