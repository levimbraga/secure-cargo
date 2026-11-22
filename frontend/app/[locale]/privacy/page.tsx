import { docRoute } from "@/lib/doc-route";

const route = docRoute("privacy");

export const generateMetadata = route.generateMetadata;
export default route.Page;
