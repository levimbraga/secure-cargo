import { docRoute } from "@/lib/doc-route";

const route = docRoute("cookies");

export const generateMetadata = route.generateMetadata;
export default route.Page;
