import { docRoute } from "@/lib/doc-route";

const route = docRoute("rules");

export const generateMetadata = route.generateMetadata;
export default route.Page;
