export function getOutboundShipping(totalAcquisitionCost) {
    if (totalAcquisitionCost < 900)
        return 60;
    if (totalAcquisitionCost < 1400)
        return 70;
    if (totalAcquisitionCost <= 1500)
        return 85; // fill your gap explicitly
    return 100;
}
export function calculateStrongOffer(askPrice, inboundShipping) {
    const total = askPrice + inboundShipping;
    const outboundShipping = getOutboundShipping(total);
    const strongOffer = Math.floor(total * 0.92 - outboundShipping);
    const walkAwayMax = Math.floor(strongOffer * 1.03);
    return {
        total,
        outboundShipping,
        strongOffer,
        walkAwayMax
    };
}
