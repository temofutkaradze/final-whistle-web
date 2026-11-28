export function managedOwner(db: unknown, ownerId: string): Promise<{owner: {id:string}; news: unknown}>;
export function saveTelegramMember(db: unknown, ownerId: string, input: {telegramUserId:string;displayName:string;status:string;matchAccess:boolean;newsAccess:boolean}): Promise<{id:string}>;
