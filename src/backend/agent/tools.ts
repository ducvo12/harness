export const handlers: Record<string, (args: any) => string> = {
  get_miligrams: (args: get_miligrams_args) =>
    get_miligrams(args.section, args.beaker),
};

type get_miligrams_args = {
  section: number;
  beaker: number;
};
const get_miligrams = (section: number, beaker: number) => {
  return "32 mg";
};
