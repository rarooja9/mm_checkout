import React, { FunctionComponent, useState, useEffect } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { LoadingOverlay } from '../ui/loading';
import { Alert } from '../ui/alert';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import { useCheckout } from "@bigcommerce/checkout/payment-integration-api";
import {
    Cart,
    Country,
    Customer,
    ConsignmentAssignmentRequestBody,
    CheckoutSelectors,
    Address
} from '@bigcommerce/checkout-sdk';

import { AddressFormModal, AddressFormValues, AddressSelect, AddressType, mapAddressFromFormValues, isValidAddress } from "../address";
import { ErrorModal } from '../common/error';
import getRecommendedShippingOption from './getRecommendedShippingOption';

// Creating a custom error class similar to ConsignmentAddressSelector
class InvalidAddressError extends Error {
    constructor() {
        super('The address is invalid');
        this.name = 'InvalidAddressError';
    }
}

export interface LineItem {
    id: string | number;
    name: string;
    imageUrl?: string;
    quantity: number;
}

export interface ConsignmentWithItem {
    id?: string;
    lineItemId: string | number;
    shippingAddress?: any;
    selectedShippingOption?: any;
    availableShippingOptions?: any[];
}

export interface CustomShippingProps {
    isBillingSameAsShipping: boolean;
    cartHasChanged: boolean;
    isMultiShippingMode: boolean;
    step: {
        isActive: boolean;
        isComplete: boolean;
        isBusy: boolean;
    };
    cart: Cart;
    consignments: any[];
    customer: Customer;
    countries: Country[];
    countriesWithAutocomplete?: string[];
    googleMapsApiKey?: string;
    isFloatingLabelEnabled?: boolean;
    shippingAddress?: any;
    navigateNextStep(isBillingSameAsShipping: boolean): void;
    onCreateAccount(): void;
    onReady?(): void;
    onSignIn(): void;
    onToggleMultiShipping(): void;
    onUnhandledError(error: Error): void;
    assignItem(consignment: ConsignmentAssignmentRequestBody): Promise<CheckoutSelectors>;
    updateBillingAddress?: (address: any) => Promise<any>;
    getFields?: (countryCode?: string) => any[];
    loadShippingOptions?: () => Promise<any>;
    deleteConsignments?: () => Promise<any>;
    selectShippingOption?: (consignmentId: string, shippingOptionId: string) => Promise<CheckoutSelectors>;
}

const CustomShipping: FunctionComponent<CustomShippingProps> = ({
    cart,
    navigateNextStep,
    isBillingSameAsShipping,
    consignments,
    customer,
    countries,
    onReady = () => { },
    onUnhandledError,
    getFields,
    deleteConsignments,
    countriesWithAutocomplete = ['US', 'CA', 'AU', 'NZ', 'GB'],
    googleMapsApiKey = '',
    isFloatingLabelEnabled,
}) => {
    const {
        checkoutService: {
            createCustomerAddress,
            loadCheckout,
        },
        checkoutState: {
            data: {
                getCheckout,
            },
        },
    } = useCheckout();

    const [isLoading, setIsLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentItemIndex, setCurrentItemIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [selectedAddress, setSelectedAddress] = useState<any>(null);
    const [selectedShippingOption, setSelectedShippingOption] = useState<any>(null);
    const [itemConsignments, setItemConsignments] = useState<ConsignmentWithItem[]>([]);
    const [isAddAddressModalOpen, setIsAddAddressModalOpen] = useState(false);
    const [configuredItems, setConfiguredItems] = useState<{ [key: string]: boolean }>({});
    const [allItemsConfigured, setAllItemsConfigured] = useState(false);
    const [createCustomerAddressError, setCreateCustomerAddressError] = useState<Error | undefined>();
    // Add originalItemOrder state to maintain the display order
    const [originalItemOrder, setOriginalItemOrder] = useState<string[]>([]);

    const physicalItems = cart.lineItems.physicalItems;

    // First initialization - only remove consignments that have multiple items
    useEffect(() => {
        const initConsignments = async () => {
            if (physicalItems.length > 0) {
                setIsLoading(true);

                try {
                    // Check if there are any consignments with multiple items that need to be split
                    const consignmentsToSplit = consignments.filter(
                        consignment => consignment.lineItemIds && consignment.lineItemIds.length > 1
                    );

                    // Save the original item order for displaying
                    const itemOrder = physicalItems.map(item => item.id.toString());
                    setOriginalItemOrder(itemOrder);

                    if (consignmentsToSplit.length > 0 && deleteConsignments) {
                        // Only delete consignments that have multiple items
                        await deleteConsignments();

                        // Initialize empty consignments for all items after deletion
                        const initialConsignments = physicalItems.map(item => ({
                            lineItemId: item.id as string,
                            shippingAddress: null,
                            selectedShippingOption: null,
                            availableShippingOptions: [],
                        }));

                        setItemConsignments(initialConsignments);
                        setConfiguredItems({});
                        setCurrentItemIndex(0);
                        setSelectedAddress(null);
                        setSelectedShippingOption(null);
                    } else {
                        // Map existing consignments to our local state model
                        const mappedConsignments: ConsignmentWithItem[] = [];
                        const configuredItemsMap: { [key: string]: boolean } = {};

                        // Process existing consignments
                        for (const consignment of consignments) {
                            for (const lineItemId of consignment.lineItemIds) {
                                mappedConsignments.push({
                                    id: consignment.id,
                                    lineItemId,
                                    shippingAddress: consignment.shippingAddress,
                                    selectedShippingOption: consignment.selectedShippingOption,
                                    availableShippingOptions: consignment.availableShippingOptions || [],
                                });

                                // Consider existing items configured if they have shipping option
                                configuredItemsMap[lineItemId] = Boolean(consignment.selectedShippingOption);
                            }
                        }

                        // Handle unconfigured items by adding them to our model
                        const configuredLineItemIds = Object.keys(configuredItemsMap);
                        physicalItems.forEach(item => {
                            if (!configuredLineItemIds.includes(item.id.toString())) {
                                mappedConsignments.push({
                                    lineItemId: item.id as string,
                                    shippingAddress: null,
                                    selectedShippingOption: null,
                                    availableShippingOptions: [],
                                });
                                configuredItemsMap[item.id] = false;
                            }
                        });

                        setItemConsignments(mappedConsignments);
                        setConfiguredItems(configuredItemsMap);

                        // Set current item index to the first unconfigured item
                        const firstUnconfiguredIndex = physicalItems.findIndex(
                            item => !configuredItemsMap[item.id]
                        );
                        setCurrentItemIndex(firstUnconfiguredIndex >= 0 ? firstUnconfiguredIndex : 0);

                        // If we're starting with a configured item, select its address and shipping option
                        if (firstUnconfiguredIndex >= 0) {
                            const currentItem = physicalItems[firstUnconfiguredIndex];
                            const consignment = mappedConsignments.find(c => c.lineItemId === currentItem.id);
                            console.log('consignment', consignment)

                            // Only pre-select fully configured items (those with both address AND shipping option)
                            if (consignment && consignment.shippingAddress && consignment.selectedShippingOption) {
                                setSelectedAddress(consignment.shippingAddress);
                                setSelectedShippingOption(consignment.selectedShippingOption);
                            } else {
                                // For unconfigured items, start fresh
                                setSelectedAddress(null);
                                setSelectedShippingOption(null);
                            }
                        }
                    }

                    // Synchronize with checkout state
                    await loadCheckout();
                } catch (err) {
                    if (err instanceof Error) {
                        setError(`Error initializing: ${err.message}`);
                    }
                } finally {
                    setIsLoading(false);
                }
            }
        };

        initConsignments();
    }, []);

    // Call onReady to signal the component is ready
    useEffect(() => {
        onReady();
    }, [onReady]);

    // Check if all items are configured
    useEffect(() => {
        if (physicalItems.length === 0) {
            setAllItemsConfigured(false);
            return;
        }

        const allConfigured = physicalItems.every(item => Boolean(configuredItems[item.id]));
        setAllItemsConfigured(allConfigured);
    }, [physicalItems, configuredItems]);

    const getCurrentItem = () => {
        return physicalItems[currentItemIndex];
    };

    const getCurrentConsignment = () => {
        const currentItem = getCurrentItem();
        return currentItem ? itemConsignments.find(c => c.lineItemId === currentItem.id) : undefined;
    };

    const createConsignment = async (address: Address, lineItemId: string | number, quantity: number) => {
        const checkout = getCheckout();

        if (!checkout) {
            throw new Error('Checkout not available');
        }

        // First check if this item already has a consignment
        const existingConsignment = consignments.find(consignment =>
            consignment.lineItemIds.length === 1 &&
            consignment.lineItemIds[0] === lineItemId.toString()
        );

        // If a consignment already exists for this item with only this item,
        // update it instead of creating a new one
        if (existingConsignment) {
            const options = {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    address: address,
                    lineItems: [{
                        itemId: lineItemId,
                        quantity: quantity
                    }]
                })
            };

            try {
                const response = await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${existingConsignment.id}?include=consignments.availableShippingOptions`, options);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.title || 'Error updating consignment');
                }

                return await response.json();
            } catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error('Unknown error updating consignment');
            }
        }
        // Otherwise create a new consignment
        else {
            const options = {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([{
                    address: address,
                    lineItems: [{
                        itemId: lineItemId,
                        quantity: quantity
                    }]
                }])
            };

            try {
                const response = await fetch(`/api/storefront/checkouts/${checkout.id}/consignments?include=consignments.availableShippingOptions`, options);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.title || 'Error creating consignment');
                }

                return await response.json();
            } catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error('Unknown error creating consignment');
            }
        }
    };

    // Update a consignment's shipping option using the Storefront API
    const updateConsignmentShippingOption = async (consignmentId: string, shippingOptionId: string) => {
        const checkout = getCheckout();

        if (!checkout) {
            throw new Error('Checkout not available');
        }

        const options = {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                shippingOptionId: shippingOptionId
            })
        };

        try {
            const response = await fetch(`/api/storefront/checkouts/${checkout.id}/consignments/${consignmentId}`, options);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.title || 'Error updating shipping option');
            }

            return await response.json();
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Unknown error updating shipping option');
        }
    };

    const handleShippingOptionSelect = async (option: any) => {
        setSelectedShippingOption(option);
        setIsLoading(true);

        try {
            // Get current consignment from our local state
            const currentConsignment = getCurrentConsignment();

            if (currentConsignment && currentConsignment.id) {
                // Use direct API call to update shipping option
                const result = await updateConsignmentShippingOption(currentConsignment.id, option.id);

                // Get updated consignments
                const updatedConsignments = result.consignments || [];

                // Find the updated consignment for our current item
                const updatedConsignment = updatedConsignments.find((c: any) =>
                    c.lineItemIds.some((lineItemId: string) =>
                        lineItemId === getCurrentItem()?.id.toString() ||
                        lineItemId === String(getCurrentItem()?.id)
                    )
                );

                // Update our local item consignments with the updated data
                if (updatedConsignment) {
                    const newItemConsignments = [...itemConsignments];
                    const currentIndex = newItemConsignments.findIndex(c => c.lineItemId === getCurrentItem()?.id);

                    if (currentIndex >= 0) {
                        newItemConsignments[currentIndex] = {
                            ...newItemConsignments[currentIndex],
                            id: updatedConsignment.id,
                            selectedShippingOption: updatedConsignment.selectedShippingOption,
                        };

                        setItemConsignments(newItemConsignments);
                    }
                }

                // Synchronize the checkout state with the changes made via direct API
                await refreshCheckoutTotals();
            } else {
                // Fallback update for local state if needed
                const updatedConsignments = [...itemConsignments];
                const currentIndex = updatedConsignments.findIndex(c => c.lineItemId === getCurrentItem()?.id);

                if (currentIndex >= 0) {
                    updatedConsignments[currentIndex] = {
                        ...updatedConsignments[currentIndex],
                        selectedShippingOption: option,
                    };

                    setItemConsignments(updatedConsignments);
                }
            }
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                setIsEditing(false);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddressSelect = async (address: Address) => {
        // Validate address before proceeding
        if (getFields && !isValidAddress(address, getFields(address.countryCode))) {
            setError('Please provide a valid address with all required fields');
            setIsEditing(false);
            onUnhandledError(new InvalidAddressError());
            return;
        }

        setSelectedAddress(address);
        setIsLoading(true);

        try {
            // Instead of using the SDK's assignItem, use direct API call to create a separate consignment
            const currentItem = getCurrentItem();

            if (currentItem) {
                // Create a single consignment for this item via direct API call
                const result = await createConsignment(address, currentItem.id, currentItem.quantity);

                // Get updated consignments from response
                const updatedConsignments = result.consignments || [];

                // Find the consignment that contains our current item
                const newConsignment = updatedConsignments.find((c: any) =>
                    c.lineItemIds.some((lineItemId: string) =>
                        lineItemId === currentItem.id.toString() ||
                        lineItemId === String(currentItem.id)
                    )
                );

                // Update our item consignments list
                if (newConsignment) {
                    const updatedItemConsignments = [...itemConsignments];
                    const currentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === currentItem.id);

                    if (currentIndex >= 0) {
                        updatedItemConsignments[currentIndex] = {
                            ...updatedItemConsignments[currentIndex],
                            id: newConsignment.id,
                            shippingAddress: address,
                            availableShippingOptions: newConsignment.availableShippingOptions || [],
                        };

                        setItemConsignments(updatedItemConsignments);

                        // Auto-select the recommended shipping option if available
                        if (newConsignment.availableShippingOptions && newConsignment.availableShippingOptions.length > 0) {
                            const recommendedOption = getRecommendedShippingOption(newConsignment.availableShippingOptions);

                            if (recommendedOption) {
                                await handleShippingOptionSelect(recommendedOption);
                            } else {
                                // If no recommended option, still need to refresh checkout state
                                await loadCheckout();
                            }
                        } else {
                            // No shipping options available, still sync checkout state
                            await loadCheckout();
                        }
                    }
                }
            }
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                setIsEditing(false);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const refreshCheckoutTotals = async () => {
        setIsLoading(true);
        try {
            const checkout = getCheckout();
            if (!checkout) {
                return;
            }

            // Force a complete refresh of checkout data to update shipping totals
            const options = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            };

            // This direct API call forces BigCommerce to recalculate all shipping totals
            await fetch(`/api/storefront/checkouts/${checkout.id}?include=cart.lineItems.physicalItems.options,consignments.availableShippingOptions`, options);

            // Reload checkout to sync UI with the latest state
            await loadCheckout();
        } catch (err) {
            console.error('Error refreshing checkout totals:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleContinue = async () => {
        if (!selectedAddress) {
            setError('Please select a shipping address');
            return;
        }

        const currentConsignmentObj = getCurrentConsignment();
        const hasShippingOptions = currentConsignmentObj &&
            currentConsignmentObj.availableShippingOptions &&
            currentConsignmentObj.availableShippingOptions.length > 0;

        if (hasShippingOptions && !selectedShippingOption) {
            setError('Please select a shipping method');
            return;
        }

        // Make sure changes are synchronized with checkout state
        await loadCheckout();

        // Mark this item as configured
        const currentItem = getCurrentItem();
        if (currentItem) {
            setConfiguredItems(prevConfiguredItems => ({
                ...prevConfiguredItems,
                [currentItem.id]: true
            }));
            setIsEditing(false);
            // If there are more items, go to the next one
            if (currentItemIndex < physicalItems.length - 1) {
                // Find the next unconfigured item
                let nextItemIndex = currentItemIndex + 1;
                const updatedConfiguredItems = {
                    ...configuredItems,
                    [currentItem.id]: true
                };
                await refreshCheckoutTotals();

                // Skip already configured items
                while (
                    nextItemIndex < physicalItems.length &&
                    updatedConfiguredItems[physicalItems[nextItemIndex].id]
                ) {
                    nextItemIndex++;
                }

                if (nextItemIndex < physicalItems.length) {
                    setCurrentItemIndex(nextItemIndex);

                    // Get the next item's consignment to pre-select its address and shipping option
                    const nextItem = physicalItems[nextItemIndex];
                    const nextConsignment = itemConsignments.find(c => c.lineItemId === nextItem.id);

                    // If the next item already has an address and shipping option, pre-select them
                    if (nextConsignment && nextConsignment.shippingAddress) {
                        setSelectedAddress(nextConsignment.shippingAddress);
                        setSelectedShippingOption(nextConsignment.selectedShippingOption);
                    } else {
                        // Otherwise, reset selections
                        setSelectedAddress(null);
                        setSelectedShippingOption(null);
                    }
                }
            }
        }
    };

    const handleUseNewAddress = () => {
        setIsAddAddressModalOpen(true);
    };

    const handleCloseAddAddressForm = () => {
        setIsAddAddressModalOpen(false);
    };

    const handleSaveAddress = async (addressFormValues: AddressFormValues) => {
        try {
            // First convert form values to an address object
            const address = mapAddressFromFormValues(addressFormValues);

            // Make sure the address is valid before proceeding
            if (getFields && !isValidAddress(address, getFields(address.countryCode))) {
                setError('Please provide a valid address with all required fields');
                onUnhandledError(new InvalidAddressError());
                return;
            }

            // Set shouldSaveAddress explicitly to ensure it's saved to the customer's address book
            address.shouldSaveAddress = true;

            // Create the customer address first using the service from useCheckout hook
            if (createCustomerAddress) {
                try {
                    await createCustomerAddress(address);
                } catch (error) {
                    if (error instanceof Error) {
                        setCreateCustomerAddressError(error);
                    }
                }
            }

            // Select the address for shipping after creating it
            await handleAddressSelect(address);
            setIsAddAddressModalOpen(false);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleCloseErrorModal = () => {
        setCreateCustomerAddressError(undefined);
    };

    const handleEditConsignment = async (index: number) => {
        // Store the original index to maintain the correct order
        if (isEditing) {
            return;
        }
        setIsEditing(true);
        setCurrentItemIndex(index);

        // Get the current item ID
        const itemId = physicalItems[index]?.id;

        // Load the selected values for this consignment
        const consignment = itemConsignments.find(c => c.lineItemId === itemId);

        if (consignment) {
            // Set the selected address and shipping option
            setSelectedAddress(consignment.shippingAddress);

            // Refresh available shipping options for this consignment
            setIsLoading(true);
            try {
                // Sync with checkout to make sure we have the latest data
                await loadCheckout();

                // Get the updated consignment from the checkout state
                const updatedConsignments = getCheckout()?.consignments || [];
                const updatedConsignment = updatedConsignments.find(c =>
                    c.lineItemIds.includes(itemId.toString())
                );

                if (updatedConsignment) {
                    // Update our local item consignment with updated shipping options
                    const updatedItemConsignments = [...itemConsignments];
                    const consignmentIndex = updatedItemConsignments.findIndex(c => c.lineItemId === itemId);

                    if (consignmentIndex >= 0) {
                        updatedItemConsignments[consignmentIndex] = {
                            ...updatedItemConsignments[consignmentIndex],
                            id: updatedConsignment.id,
                            availableShippingOptions: updatedConsignment.availableShippingOptions || [],
                            selectedShippingOption: updatedConsignment.selectedShippingOption
                        };

                        setItemConsignments(updatedItemConsignments);
                        setSelectedShippingOption(updatedConsignment.selectedShippingOption);
                    }
                }
            } catch (err) {
                if (err instanceof Error) {
                    setError(`Error loading shipping options: ${err.message}`);
                }
            } finally {
                setIsLoading(false);
            }

            // Important: Mark this item as NOT configured so it shows in edit mode
            const updatedConfiguredItems = { ...configuredItems };
            delete updatedConfiguredItems[itemId];
            setConfiguredItems(updatedConfiguredItems);
            await refreshCheckoutTotals();
        }
    };


    const handleFinalContinue = async () => {
        if (isLoading) return;

        setIsLoading(true);

        try {
            // Make sure all changes are synchronized with BigCommerce checkout state
            await refreshCheckoutTotals();

            // Call navigateNextStep with the current billing/shipping relationship
            navigateNextStep(isBillingSameAsShipping);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
                setIsEditing(false);
                onUnhandledError(err);
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (!physicalItems.length) {
        return <div>No physical items in cart</div>;
    }

    const currentItem = getCurrentItem();
    const currentConsignment = getCurrentConsignment();

    if (!currentItem) {
        return <div>Loading...</div>;
    }

    const renderItem = (item: LineItem, index: number) => {
        const isConfigured = configuredItems[item.id];
        const isBeingEdited = currentItemIndex === index && !isConfigured;
        const consignment = itemConsignments.find(c => c.lineItemId === item.id);
        
        return (
            <div 
                key={item.id} 
                className={`tt-custom-item-wrapper ${isBeingEdited ? 'tt-custom-item-editing' : ''}`}
            >
                {/* Item Image and Basic Details - Always Visible */}
                <div className="tt-custom-item-base-info">
                    <div className="tt-custom-item-image-container">
                        {item.imageUrl && (
                            <img src={item.imageUrl} alt={item.name} className="tt-custom-item-image" />
                        )}
                    </div>
                    <div className="tt-custom-item-details">
                        <span className="tt-custom-item-name">{item.name}</span>
                        <span className="tt-custom-item-quantity">Qty: {item.quantity}</span>
                    </div>
                </div>

                {/* Editing or Configured State */}
                {isBeingEdited ? (
                    <div className="tt-custom-item-editing-container">
                        {/* Address Selection */}
                        <div className="tt-custom-address-selection">
                            <h4 className="optimizedCheckout-headingSecondary">
                                Shipping Address
                            </h4>
                            <div className="tt-custom-address-select-container">
                                {customer.addresses.length > 0 ? (
                                    <AddressSelect
                                        addresses={customer.addresses}
                                        selectedAddress={selectedAddress}
                                        type={AddressType.Shipping}
                                        onSelectAddress={handleAddressSelect}
                                        onUseNewAddress={handleUseNewAddress}
                                        placeholderText={<TranslatedString id="shipping.choose_shipping_address" />}
                                        showSingleLineAddress
                                    />
                                ) : (
                                    <Button
                                        onClick={handleUseNewAddress}
                                        testId="add-new-address"
                                        variant={ButtonVariant.Secondary}
                                        className="optimizedCheckout-buttonSecondary"
                                    >
                                        Add address
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Shipping Options */}
                        {selectedAddress && (
                            <div className="tt-custom-shipping-options">
                                <h4 className="optimizedCheckout-headingSecondary">
                                    Shipping Method
                                </h4>

                                {currentConsignment && currentConsignment.availableShippingOptions && currentConsignment.availableShippingOptions.length > 0 ? (
                                    <div className="tt-custom-shipping-options-list">
                                        {currentConsignment.availableShippingOptions.map(option => (
                                            <div
                                                key={option.id}
                                                className={`tt-custom-shipping-option ${selectedShippingOption?.id === option.id ? 'selected' : ''}`}
                                                onClick={() => handleShippingOptionSelect(option)}
                                            >
                                                <input
                                                    type="radio"
                                                    name="shippingOption"
                                                    id={option.id}
                                                    checked={selectedShippingOption?.id === option.id}
                                                    onChange={() => handleShippingOptionSelect(option)}
                                                />
                                                <label htmlFor={option.id}>
                                                    <div className="tt-custom-option-description">{option.description}</div>
                                                    <div className="tt-custom-option-cost">${option.cost.toFixed(2)}</div>
                                                    {option.transitTime && <div className="tt-custom-option-transit">{option.transitTime}</div>}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="tt-custom-no-shipping-options">
                                        No shipping options available for this address
                                    </div>
                                )}
                            </div>
                        )}

                          {/* Error Alert */}
                          {error && (
                            <Alert>
                                {error}
                            </Alert>
                        )}

                        {/* Continue Button */}
                        <div className="form-actions">
                            <Button
                                id="checkout-shipping-continue"
                                onClick={handleContinue}
                                disabled={
                                    isLoading ||
                                    !selectedAddress ||
                                    (currentConsignment &&
                                        currentConsignment.availableShippingOptions &&
                                        currentConsignment.availableShippingOptions.length > 0 &&
                                        !selectedShippingOption)
                                }
                                variant={ButtonVariant.Primary}
                                testId="checkout-shipping-continue"
                                className="optimizedCheckout-buttonPrimary"
                            >
                                {currentItemIndex < physicalItems.length - 1 ? (
                                    <span>Next</span>
                                ) : (
                                    <span>Continue</span>
                                )}
                            </Button>
                        </div>
                    </div>
                ) : isConfigured && consignment ? (
                    <div className="tt-custom-item-configured-container">
                        <div className="tt-custom-item-address">
                            {consignment?.shippingAddress && (
                                <div>
                                    <span className="tt-custom-address-name">
                                        {consignment.shippingAddress.firstName} {consignment.shippingAddress.lastName}
                                    </span>
                                    <span className="tt-custom-address-line">
                                        {consignment.shippingAddress.address1}
                                    </span>
                                    <span className="tt-custom-address-city-state">
                                        {consignment.shippingAddress.city}, {consignment.shippingAddress.stateOrProvinceCode} {consignment.shippingAddress.postalCode}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="tt-custom-item-shipping-method">
                            {consignment?.selectedShippingOption && (
                                <span>{consignment.selectedShippingOption.description}</span>
                            )}
                        </div>
                        <div className="tt-custom-item-actions">
                            <Button
                                onClick={() => handleEditConsignment(index)}
                                variant={ButtonVariant.Secondary}
                                className="optimizedCheckout-buttonSecondary"
                                disabled={isEditing}
                            >
                                Edit
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    };


    // Sort physical items based on original order to maintain consistency
    const orderedPhysicalItems = [...physicalItems].sort((a, b) => {
        const aIndex = originalItemOrder.indexOf(a.id.toString());
        const bIndex = originalItemOrder.indexOf(b.id.toString());
        return aIndex - bIndex;
    });

    return (
        <div className="checkout-form">
            <LoadingOverlay isLoading={isLoading}>
                <div className="tt-custom-shipping-container">
                    {/* Error and Address Form Modals (keep existing) */}
                    <ErrorModal
                        error={createCustomerAddressError}
                        message={
                            <>
                                <TranslatedString id="address.consignment_address_updated_text" />{' '}
                                <TranslatedString id="customer.create_address_error" />
                            </>
                        }
                        onClose={handleCloseErrorModal}
                        shouldShowErrorCode={false}
                    />

                    <AddressFormModal
                        countries={countries}
                        countriesWithAutocomplete={countriesWithAutocomplete || ['US', 'CA', 'AU', 'NZ', 'GB']}
                        defaultCountryCode={selectedAddress?.countryCode || customer?.addresses?.[0]?.countryCode}
                        getFields={getFields || (() => [])}
                        googleMapsApiKey={googleMapsApiKey || ''}
                        isFloatingLabelEnabled={isFloatingLabelEnabled}
                        isLoading={isLoading}
                        isOpen={isAddAddressModalOpen}
                        onRequestClose={handleCloseAddAddressForm}
                        onSaveAddress={handleSaveAddress}
                        shouldShowSaveAddress={true}
                    />

                    {/* Render all items in original order */}
                    <div className="tt-custom-items-container">
                        {orderedPhysicalItems.map((item, index) => renderItem(item, index))}
                    </div>

                    {/* Final Continue Button */}
                    {allItemsConfigured && (
                        <div className="form-actions">
                            <Button
                                id="checkout-shipping-final-continue"
                                onClick={handleFinalContinue}
                                variant={ButtonVariant.Primary}
                                className="optimizedCheckout-buttonPrimary"
                            >
                                Continue
                            </Button>
                        </div>
                    )}
                </div>
            </LoadingOverlay>
        </div>
    );
};

export default CustomShipping;
