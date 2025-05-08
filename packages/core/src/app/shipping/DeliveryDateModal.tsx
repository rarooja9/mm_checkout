import React, { FunctionComponent, useEffect, useState } from 'react';
import { Button, ButtonVariant } from '../ui/button';
import { Modal } from '../ui/modal';
import { LoadingOverlay } from '../ui/loading';
import ShippingCalendarSelector from './CustomShippingCalendar';

interface DeliveryDateModalProps {
    isOpen: boolean;
    isLoading: boolean;
    calendarData: any;
    selectedShippingOption: any;
    selectedShippingDate: Date | null;
    isDatePickerMode?: boolean;
    onSubmit: (shippingOption: any, deliveryDate: Date) => void;
    onRequestClose: () => void;
}

const DeliveryDateModal: FunctionComponent<DeliveryDateModalProps> = ({
    isOpen,
    isLoading,
    calendarData,
    selectedShippingOption: initialShippingOption,
    selectedShippingDate: initialShippingDate,
    onSubmit,
    onRequestClose,
}) => {
    const [selectedOption, setSelectedOption] = useState(initialShippingOption);
    const [selectedDate, setSelectedDate] = useState(initialShippingDate);

    // Update local state when props change
    useEffect(() => {
        if (isOpen) {
            setSelectedOption(initialShippingOption);
            setSelectedDate(initialShippingDate);
        }
    }, [isOpen, initialShippingOption, initialShippingDate]);

    const handleShippingOptionSelect = (option: any) => {
        setSelectedOption(option);
    };

    const handleDeliveryDateSelect = (date: Date) => {
        setSelectedDate(date);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedOption && selectedDate) {
            onSubmit(selectedOption, selectedDate);
        }
    };

    // Prevent clicks inside the modal content from closing the modal
    const handleModalContentClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    const isSubmitDisabled = !selectedOption || !selectedDate || isLoading;

    return (
        <Modal
            additionalModalClassName="modal--large"
            isOpen={isOpen}
            onRequestClose={onRequestClose}
            shouldShowCloseButton={true}
        >
            <LoadingOverlay isLoading={isLoading}>
                {/* Add onClick handler to prevent click propagation */}
                <div onClick={handleModalContentClick}>
                    <form onSubmit={handleSubmit}>
                        <div className="form-field">
                            {calendarData ? (
                                <ShippingCalendarSelector
                                    calendarData={calendarData}
                                    onSelectShippingOption={handleShippingOptionSelect}
                                    onSelectDeliveryDate={handleDeliveryDateSelect}
                                    selectedShippingOption={selectedOption}
                                    selectedShippingDate={selectedDate}
                                    isLoading={isLoading}
                                />
                            ) : (
                                <div className="loading-placeholder">Loading delivery options...</div>
                            )}
                        </div>
                        <div className="form-actions">
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent event propagation
                                    onRequestClose();
                                }}
                                variant={ButtonVariant.Secondary}
                                type="button" // Explicitly set type to button
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                variant={ButtonVariant.Primary}
                                disabled={isSubmitDisabled}
                                onClick={(e) => e.stopPropagation()} // Prevent event propagation
                            >
                                Confirm Selection
                            </Button>
                        </div>
                    </form>
                </div>
            </LoadingOverlay>
        </Modal>
    );
};

export default DeliveryDateModal;