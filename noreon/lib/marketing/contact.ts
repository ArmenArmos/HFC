export type ContactRequest = {
  id: string;
  name: string;
  email: string;
  message: string;
  callback: boolean;
  phone: string;
  website: string;
};

export function validContact(input: ContactRequest): boolean {
  return typeof input?.id === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(input.id)
    && typeof input.name === "string" && input.name.trim().length > 0 && input.name.length <= 100
    && typeof input.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) && input.email.length <= 320
    && typeof input.message === "string" && input.message.trim().length > 0 && input.message.length <= 2000
    && typeof input.callback === "boolean" && typeof input.phone === "string" && input.phone.length <= 50
    && (!input.callback || /^[+\d().\s-]{6,50}$/.test(input.phone.trim()))
    && typeof input.website === "string";
}
