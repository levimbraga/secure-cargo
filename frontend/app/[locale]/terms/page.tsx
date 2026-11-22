import { docRoute } from "@/lib/doc-route";

const route = docRoute("terms");

export const generateMetadata = route.generateMetadata;
export default route.Page;
