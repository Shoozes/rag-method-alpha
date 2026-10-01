export interface DisposableResource {
  dispose(): void;
}

export interface OptionalResourceOptions<T extends DisposableResource> {
  readonly load: () => Promise<() => Promise<T>>;
  readonly isCurrent: () => boolean;
  readonly accept: (resource: T) => void;
  readonly reject: (error: unknown) => void;
}

export async function initializeOptionalResource<T extends DisposableResource>(
  options: OptionalResourceOptions<T>,
): Promise<void> {
  try {
    const create = await options.load();
    const resource = await create();
    if (!options.isCurrent()) {
      resource.dispose();
      return;
    }
    options.accept(resource);
  } catch (error) {
    if (options.isCurrent()) options.reject(error);
  }
}
