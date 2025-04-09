// Helper functions to maintain consignment data in session storage

interface StoredConsignment {
    consignmentId: string;
    lineItemId: string | number;
    quantity: number;
    shippingAddress: any;
    selectedShippingOptionId: string;
    selectedDeliveryDate?: {
        display: string;
        iso: string;
        value: number;
    };
}

// Save consignment data to session storage
export const saveConsignmentToSession = (
    consignmentId: string, 
    lineItemId: string | number, 
    quantity: number,
    shippingAddress: any,
    selectedShippingOptionId: string,
    selectedDeliveryDate?: {
        display: string;
        iso: string;
        value: number;
    }
) => {
    try {
        // Get existing stored consignments or initialize empty array
        const storedConsignmentsString = sessionStorage.getItem('storedConsignments');
        const storedConsignments: StoredConsignment[] = storedConsignmentsString 
            ? JSON.parse(storedConsignmentsString) 
            : [];
        
        // Check if this consignment already exists in storage
        const existingIndex = storedConsignments.findIndex(c => c.consignmentId === consignmentId);
        
        // Create consignment data object
        const consignmentData: StoredConsignment = {
            consignmentId,
            lineItemId,
            quantity,
            shippingAddress,
            selectedShippingOptionId,
            selectedDeliveryDate
        };
        
        // Update existing or add new entry
        if (existingIndex >= 0) {
            storedConsignments[existingIndex] = consignmentData;
        } else {
            storedConsignments.push(consignmentData);
        }
        
        // Save back to session storage
        sessionStorage.setItem('storedConsignments', JSON.stringify(storedConsignments));
    } catch (error) {
        console.error('Error saving consignment to session storage:', error);
    }
};

export const saveDeliveryDateToSession = (
    lineItemId: string | number,
    deliveryDate: {
        display: string;
        iso: string;
        value: number;
    }
) => {
    try {
        const storedDeliveryDatesString = sessionStorage.getItem('storedDeliveryDates');
        const storedDeliveryDates = storedDeliveryDatesString 
            ? JSON.parse(storedDeliveryDatesString) 
            : [];
        
        const existingIndex = storedDeliveryDates.findIndex((d: any) => d.lineItemId === lineItemId);
        
        const deliveryDateEntry = { lineItemId, deliveryDate };
        
        if (existingIndex >= 0) {
            storedDeliveryDates[existingIndex] = deliveryDateEntry;
        } else {
            storedDeliveryDates.push(deliveryDateEntry);
        }
        
        sessionStorage.setItem('storedDeliveryDates', JSON.stringify(storedDeliveryDates));
    } catch (error) {
        console.error('Error saving delivery date to session storage:', error);
    }
};

// Retrieve consignments from session storage
export const getStoredConsignments = (): StoredConsignment[] => {
    try {
        const storedConsignmentsString = sessionStorage.getItem('storedConsignments');
        return storedConsignmentsString ? JSON.parse(storedConsignmentsString) : [];
    } catch (error) {
        console.error('Error retrieving consignments from session storage:', error);
        return [];
    }
};

// Find a stored consignment by line item ID
export const findStoredConsignmentByLineItemId = (
    lineItemId: string | number, 
    quantity: number
): StoredConsignment | undefined => {
    const storedConsignments = getStoredConsignments();
    return storedConsignments.find(c => 
        c.lineItemId.toString() === lineItemId.toString() && 
        c.quantity === quantity
    );
};

// Find a stored consignment by consignment ID
export const findStoredConsignmentById = (
    consignmentId: string
): StoredConsignment | undefined => {
    const storedConsignments = getStoredConsignments();
    return storedConsignments.find(c => c.consignmentId === consignmentId);
};

// Update or create a stored consignment with current data
export const updateStoredConsignment = (
    consignmentId: string,
    lineItemId: string | number,
    quantity: number,
    shippingAddress: any,
    selectedShippingOptionId: string,
    selectedDeliveryDate?: {
        display: string;
        iso: string;
        value: number;
    }
) => {
    saveConsignmentToSession(
        consignmentId,
        lineItemId,
        quantity,
        shippingAddress,
        selectedShippingOptionId,
        selectedDeliveryDate
    );
};

// Remove a stored consignment
export const removeStoredConsignment = (consignmentId: string) => {
    try {
        const storedConsignments = getStoredConsignments();
        const filteredConsignments = storedConsignments.filter(c => c.consignmentId !== consignmentId);
        sessionStorage.setItem('storedConsignments', JSON.stringify(filteredConsignments));
    } catch (error) {
        console.error('Error removing consignment from session storage:', error);
    }
};