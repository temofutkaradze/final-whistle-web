// Internal capabilities. Neither the bot's update payload nor the scoped proxy exposes these.
const contexts=new WeakMap();
export function registerMemberContext(scoped,context){contexts.set(scoped,context);}
export function authorizationDatabase(db){return contexts.get(db)?.authorization??db;}
export function memberBackgroundTransaction(db,key,work){return contexts.get(db)?.background(key,work);}
