import { docRoute } from "@/lib/doc-route";

const route = docRoute("methodology");

export const generateMetadata = route.generateMetadata;
export default route.Page;
