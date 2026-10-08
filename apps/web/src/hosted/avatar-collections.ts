import type { CatalogResponse } from "./HostedProductScreens";

export function avatarCollections(catalog?: CatalogResponse) {
  const own = catalog?.avatars ?? [];
  const collections = catalog?.avatar_collections ?? [];
  const foreign = collections.filter((item) => !item.is_current_user);
  const everyone = [
    ...new Map(
      [...own, ...foreign.flatMap((item) => item.avatars)].map((item) => [item.version_id, item]),
    ).values(),
  ];
  function label(id: string) {
    const item = collections.find((item) => item.id === id);
    if (!item) return "";
    // ponytail: small invited roster; precompute duplicate ranks if the roster grows.
    const namesakes = collections.filter((other) => other.name === item.name);
    return namesakes.length > 1
      ? `${item.name} (${namesakes.findIndex((other) => other.id === id) + 1})`
      : item.name;
  }
  return {
    everyone,
    items: (id: string) =>
      id === "mine"
        ? own
        : id === "everyone"
          ? everyone
          : (collections.find((item) => item.id === id)?.avatars ?? []),
    owner: (versionId: string) =>
      collections.find((item) => item.avatars.some((avatar) => avatar.version_id === versionId)),
    label,
    options: [
      {
        value: "mine",
        label: "My avatars",
        description: collections.find((item) => item.is_current_user)?.email,
        count: own.length,
      },
      { value: "everyone", label: "Everyone", count: everyone.length },
      ...foreign.map((item) => ({
        value: item.id,
        label: label(item.id),
        description: item.email,
        count: item.avatars.length,
      })),
    ],
  };
}
